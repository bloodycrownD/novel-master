/**
 * C1-6 / C1-7：smart-sort 多语句写入口的事务化 + `renumber` 批量下沉。
 *
 * 注入缝：直接 `new DefaultSmartSortRuleService({ conn, createRules, builtinSeed })`
 * ——工厂 `createSmartSortRuleService(conn)` 内部自造 deps，无法注入。`createRules`
 * 返回一个装饰仓储：记录「自己是用哪个 conn 造的」（事务内必须是 tx 句柄）、
 * 可按调用序号注入故障。
 *
 * ⚠️ 观测面纪律：
 * - 原子性断言用「调用前后全表逐条 deepEqual」——**不得**用「deleteAll 被调用过」
 *   当断言（那对回滚无牙齿）；
 * - 连接身份断言只能来自 `createRules` 注入缝（`sql-counting-connection.ts`
 *   的 `SqlCounter.record` 只记 `(sql, kind, via)`，记不了连接身份）；
 * - `update` / `updateSortOrders` 的计数打在 **repository prototype** 上，不在 service 上。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BUILTIN_SMART_SORT_RULE_ROWS } from "@/bootstrap/smart-sort-rule/builtin-smart-sort-rules.js";
import { isBuiltinSmartSortRuleId } from "@/domain/smart-sort-rule/model/smart-sort-rule.js";
import { SqliteSmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository.js";
import type { SmartSortRuleRepository } from "@/domain/smart-sort-rule/repositories/smart-sort-rule.port.js";
import { DefaultSmartSortRuleService } from "@/service/smart-sort-rule/impl/smart-sort-rule.service.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

interface Harness {
  readonly service: DefaultSmartSortRuleService;
  readonly txCalls: () => number;
  /** 记录每个建出的仓储拿的是哪个连接（用于连接身份断言）。 */
  readonly repoConns: () => unknown[];
  /**
   * 最近一次 `transaction` 回调收到的 tx 句柄（I4 连接身份断言的真源）。
   *
   * ⚠ 不能拿根连接当比较对象：service 的根连接是 `countingConn` 包装对象，
   * `countingConn !== ctx.conn` 恒成立 ⇒ 拿它当基准的断言是恒真牙（cr1-c1 P2-4）。
   */
  readonly seenTx: () => TdbcConnection | null;
  /** 下一个 insert/delete/update 的第几次调用抛错（0 = 不抛）。 */
  failOn: (op: "insert" | "delete" | "update", nth: number) => void;
}

function makeHarness(): Harness {
  const ctx = getNovelMasterTestContext();
  const repoConns: unknown[] = [];
  const failAt = new Map<string, number>();
  let txCalls = 0;
  let lastTx: TdbcConnection | null = null;
  const counters = new Map<string, number>();

  const origTx = ctx.conn.transaction.bind(ctx.conn);
  const countingConn: TdbcConnection = {
    execute: (sql, p) => ctx.conn.execute(sql, p),
    query: (sql, p) => ctx.conn.query(sql, p),
    batch: (sql, pl) => ctx.conn.batch(sql, pl),
    transaction: (fn) => {
      txCalls += 1;
      // 包一层把回调收到的句柄记下来，供 I4 的对象同一性断言用。
      return origTx((tx) => {
        lastTx = tx;
        return fn(tx);
      });
    },
    close: () => ctx.conn.close(),
  };

  const createRules = (conn: TdbcConnection): SmartSortRuleRepository => {
    repoConns.push(conn);
    const inner = new SqliteSmartSortRuleRepository(conn);
    const guard = <T>(op: "insert" | "delete" | "update", run: () => T): T => {
      const key = `${op}`;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      if (failAt.get(key) === n) {
        throw new Error(`injected ${op} failure #${n}`);
      }
      return run();
    };
    return {
      listOrdered: () => inner.listOrdered(),
      find: (id) => inner.find(id),
      insert: (rule) => guard("insert", () => inner.insert(rule)),
      update: (rule) => guard("update", () => inner.update(rule)),
      delete: (id) => guard("delete", () => inner.delete(id)),
      deleteAll: () => inner.deleteAll(),
      nextSortOrder: () => inner.nextSortOrder(),
      updateSortOrders: (pairs) => inner.updateSortOrders(pairs),
    };
  };

  const service = new DefaultSmartSortRuleService({
    conn: countingConn,
    createRules,
    builtinSeed: BUILTIN_SMART_SORT_RULE_ROWS,
  });

  return {
    service,
    txCalls: () => txCalls,
    repoConns: () => repoConns,
    seenTx: () => lastTx,
    failOn: (op, nth) => {
      counters.delete(op);
      failAt.set(op, nth);
    },
  };
}

async function resetToClean(): Promise<Harness> {
  const ctx = getNovelMasterTestContext();
  const svc = createRawService(ctx.conn);
  for (const rule of await svc.listRules()) {
    if (!isBuiltinSmartSortRuleId(rule.ruleId)) {
      await svc.deleteRule(rule.ruleId);
    }
  }
  await svc.resetDefaults();
  return makeHarness();
}

function createRawService(conn: TdbcConnection): DefaultSmartSortRuleService {
  return new DefaultSmartSortRuleService({
    conn,
    createRules: (c) => new SqliteSmartSortRuleRepository(c),
    builtinSeed: BUILTIN_SMART_SORT_RULE_ROWS,
  });
}

describe("smart-sort 多语句写入口的事务化（C1-6 / C1-7）", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await resetToClean();
  });

  it("T-SRTX1 importRules 中途失败 → 全表逐条不变（deleteAll 被回滚）", async () => {
    const before = await h.service.listRules();
    // 造一个 3 条规则的 bundle，让第 2 条 insert 抛错。
    const doc = {
      schemaVersion: 1 as const,
      rules: [1, 2, 3].map((i) => ({
        ruleId: `rule-imp-${i}`,
        name: `导入${i}`,
        pattern: `第([0-9]+)话${i}`,
        flags: "",
        enabled: true,
        sortOrder: i,
      })),
    };
    h.failOn("insert", 2);
    await assert.rejects(() => h.service.importRules(doc));
    assert.deepEqual(await h.service.listRules(), before, "deleteAll 必须被回滚");
  });

  it("T-SRTX2 importRules 恰好一次事务，返回值即事务内读", async () => {
    h = await resetToClean();
    const before = h.txCalls();
    const doc = {
      schemaVersion: 1 as const,
      rules: [
        {
          ruleId: "rule-imp-a",
          name: "A",
          pattern: "第([0-9]+)话",
          flags: "",
          enabled: true,
          sortOrder: 1,
        },
      ],
    };
    const out = await h.service.importRules(doc);
    assert.equal(h.txCalls() - before, 1, "importRules 必须恰好一次事务");
    assert.deepEqual(
      out.map((r) => r.ruleId),
      ["rule-imp-a"],
    );
  });

  it("T-SRTX3 单语句入口零事务", async () => {
    h = await resetToClean();
    const before = h.txCalls();
    const created = await h.service.createRule({
      name: "单条",
      pattern: "第([0-9]+)话",
      description: null,
    });
    await h.service.listRules();
    await h.service.updateRule(created.ruleId, { description: "改" });
    await h.service.setEnabled(created.ruleId, false);
    await h.service.deleteRule(created.ruleId);
    assert.equal(h.txCalls() - before, 0, "单语句入口不得开事务");
  });

  it("T-SRTX4 校验失败零事务、零写入", async () => {
    h = await resetToClean();
    const before = h.txCalls();
    const rules = await h.service.listRules();
    const doc = {
      schemaVersion: 1 as const,
      rules: [
        { ...toWire(rules[0]!) },
        { ...toWire(rules[0]!) },
      ],
    };
    await assert.rejects(() => h.service.importRules(doc));
    assert.equal(h.txCalls() - before, 0, "校验段必须在事务外");
  });

  it("T-SRTX5 resetDefaults 中途失败 → 全表不变", async () => {
    await h.service.createRule({
      name: "用户规则",
      pattern: "第([0-9]+)话",
      description: null,
    });
    const beforeReset = await h.service.listRules();
    // `failOn` 计的是**全局**第 N 次 insert：上面 createRule 已经吃掉 1 次，
    // 所以这里 failOn("insert", 3) 炸的是 resetDefaults 里 seed 的**第 2** 条
    // （seed 共 7 条，够用，不影响结果）。别把它读成「seed 的第 3 条」。
    h.failOn("insert", 3);
    await assert.rejects(() => h.service.resetDefaults());
    assert.deepEqual(
      await h.service.listRules(),
      beforeReset,
      "resetDefaults 三段必须同生共死",
    );
  });

  it("T-SRTX6 deleteBatch / setEnabledBatch 中途失败 → 零半删", async () => {
    const a = await h.service.createRule({
      name: "A",
      pattern: "第([0-9]+)话",
      description: null,
    });
    const b = await h.service.createRule({
      name: "B",
      pattern: "第([0-9]+)章",
      description: null,
    });
    const c = await h.service.createRule({
      name: "C",
      pattern: "第([0-9]+)篇",
      description: null,
    });
    const beforeIds = (await h.service.listRules()).map((r) => r.ruleId);

    h.failOn("delete", 2);
    await assert.rejects(() => h.service.deleteBatch([a.ruleId, b.ruleId, c.ruleId]));
    assert.deepEqual(
      (await h.service.listRules()).map((r) => r.ruleId),
      beforeIds,
      "deleteBatch 不得半删",
    );

    h = await resetToClean();
    const before = await h.service.listRules();
    h.failOn("update", 2);
    await assert.rejects(() =>
      h.service.setEnabledBatch(
        [before[0]!.ruleId, before[1]!.ruleId, before[2]!.ruleId],
        false,
      ),
    );
    assert.deepEqual(
      (await h.service.listRules()).map((r) => r.enabled),
      before.map((r) => r.enabled),
      "setEnabledBatch 不得半改",
    );
  });

  it("T-SRTX7 setEnabledBatch 的写全部落在事务内（连接身份断言）", async () => {
    h = await resetToClean();
    const rules = await h.service.listRules();
    const connsBefore = h.repoConns().length;
    await h.service.setEnabledBatch(
      [rules[0]!.ruleId, rules[1]!.ruleId],
      false,
    );
    const newConns = h.repoConns().slice(connsBefore);
    // 事务内建的仓储拿的必须是 `transaction` 回调收到的那个 tx 句柄。
    //
    // ⚠ 旧断言比的是 `!== ctx.conn`，而 service 的**根连接是 countingConn**
    // （一个包装对象），不是 `ctx.conn` ⇒ 「事务内经根连接造仓储」这一回归
    // 记录到的也是 countingConn，`countingConn !== ctx.conn` 照样成立 ⇒ 恒真。
    // cr1-c1 P2-4：改成与回调传入句柄的**对象同一性**（spec C1-7 I4 原文口径）。
    const seenTx = h.seenTx();
    assert.ok(seenTx != null, "本轮必须真的开过一次事务");
    for (const c of newConns) {
      assert.equal(
        c,
        seenTx,
        "事务内不得经根连接造仓储（AsyncMutex 不可重入）",
      );
    }
    assert.ok(newConns.length >= 1);
  });

  it("T-SRTX8 renumber 下沉后零次逐条 update、一次批量", async () => {
    h = await resetToClean();
    const created: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await h.service.createRule({
        name: `R${i}`,
        pattern: `第([0-9]+)话${i}`,
        description: null,
      });
      created.push(r.ruleId);
    }
    const all = await h.service.listRules();
    const reversed = [...all].reverse().map((r) => r.ruleId);

    const proto = SqliteSmartSortRuleRepository.prototype;
    const origUpdate = proto.update;
    const origBatch = proto.updateSortOrders;
    let updateCalls = 0;
    let batchCalls = 0;
    let pairsLen = 0;
    proto.update = function patched(...args: never[]) {
      updateCalls += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origUpdate as any).apply(this, args);
    } as typeof origUpdate;
    proto.updateSortOrders = function patched(
      this: SqliteSmartSortRuleRepository,
      ...args: never[]
    ) {
      batchCalls += 1;
      const pairs = (args[0] ?? []) as readonly unknown[];
      pairsLen = pairs.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origBatch as any).apply(this, args);
    } as typeof origBatch;
    try {
      await h.service.reorderRules(reversed);
    } finally {
      proto.update = origUpdate;
      proto.updateSortOrders = origBatch;
    }

    assert.equal(updateCalls, 0, "逐条 update 必须归零");
    assert.equal(batchCalls, 1, "renumber 必须一次批量");
    assert.ok(pairsLen > 0 && pairsLen <= reversed.length);
    const after = await h.service.listRules();
    assert.deepEqual(
      after.map((r) => r.ruleId),
      reversed,
    );
    assert.deepEqual(
      after.map((r) => r.sortOrder),
      after.map((_, i) => i + 1),
      "批量重排后 sort_order 连续 1..N",
    );
    assert.ok(created.length === 20);
  });

  it("T-SRTX9 reorderRules 校验失败零事务", async () => {
    h = await resetToClean();
    const before = h.txCalls();
    const rules = await h.service.listRules();
    await assert.rejects(() => h.service.reorderRules([rules[0]!.ruleId]));
    assert.equal(h.txCalls() - before, 0, "校验必须留在事务外");
  });

  it("T-SRTX10 600 对分片重排不触发 too many SQL variables", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createRawService(ctx.conn);
    for (const r of await svc.listRules()) {
      if (!isBuiltinSmartSortRuleId(r.ruleId)) {
        await svc.deleteRule(r.ruleId);
      }
    }
    await svc.resetDefaults();
    // 造 600 条规则（bulk insert 走 conn.batch，避免 600 次往返）。
    const ids: string[] = [];
    const now = Date.now();
    for (let i = 0; i < 600; i++) {
      const id = `bulk-${i}`;
      ids.push(id);
      await ctx.conn.execute(
        `INSERT INTO smart_sort_rule (rule_id, name, pattern, flags, capture_kind, description, enabled, sort_order, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [id, `n${i}`, `第([0-9]+)话${i}`, "", "smart", null, i + 1, now, now],
      );
    }
    const all = await svc.listRules();
    const reversed = [...all].reverse().map((r) => r.ruleId);
    assert.equal(reversed.length, 607);
    const out = await svc.reorderRules(reversed);
    assert.equal(out.length, 607);
    assert.equal(ids.length, 600);
  });
});

function toWire(rule: {
  ruleId: string;
  name: string;
  pattern: string;
  flags: string;
  enabled: boolean;
  sortOrder: number;
  description: string | null;
}): {
  ruleId: string;
  name: string;
  pattern: string;
  flags: string;
  enabled: boolean;
  sortOrder: number;
  description: string | null;
} {
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    pattern: rule.pattern,
    flags: rule.flags,
    enabled: rule.enabled,
    sortOrder: rule.sortOrder,
    description: rule.description,
  };
}