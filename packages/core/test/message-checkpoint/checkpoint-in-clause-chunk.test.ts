/**
 * C2-9（CS-10）· checkpoint 仓储三方法补 900 分块的回归锁：I2 / I3 / I4。
 *
 * 病症原形态：`sqlite-message-checkpoint.repository.ts` 三处按**变长 arity** 拼
 * `IN (#{id0}, #{id1}, …)` 且不分块。同一文件里 `insertMultiValues` 早就有
 * `MULTI_VALUES_MAX_VARS = 900` 的正确分块范例，这三处 IN 查询漏了。
 *
 * 补分块后各处的量级变化：
 *  - **I3（主差分断言）**：1200 个 id ⇒ 至少 2 块；**任一块绑定变量总数 ≤ 900**
 *    （块大小 = `IN_LIST_MAX_VARS - fixedVars`，含 sessionId 共 ≤900）。
 *    这条在旧实现下必红（旧实现一条语句绑 1201 个变量）。
 *  - **I2 结果等价**：整段调用 == 按 900/300 拆成两次调用（计数相等、指针行集合
 *    与顺序相同、删除后剩余行集合与 `vfs_revision.ref_count` 一致）。
 *  - **I4 边界**：id 数 0 / 1 / 899 / 900 / 901。0 早退**不发 SQL**。
 *
 * 观测面：包装 `conn` 记每次 `query` / `execute` / `batch` 的
 * **绑定参数个数**（`queryTemplate` 把命名绑定渲染成位置参数后走
 * `connection.query(sql, parameters)`，所以参数个数就是那一块的真变量数）。
 * 观测面刻意不复用 `sql-counting-connection` 的 SqlCounter——那边只记 SQL 文本，
 * 不记参数个数，而本条的全部牙齿都在「这一次绑了几个变量」上。
 *
 * @module test/message-checkpoint/checkpoint-in-clause-chunk
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { openSqlCountingNovelMasterTestConnection } from "../helpers/sql-counting-connection.js";
import { testIsolationSuffix } from "../helpers/novel-master-fixture.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import type { Row } from "../../src/infra/tdbc/types.js";

type Ctx = Awaited<ReturnType<typeof openSqlCountingNovelMasterTestConnection>>;

let ctx: Ctx;

before(async () => {
  ctx = await openSqlCountingNovelMasterTestConnection();
});
after(async () => {
  await ctx.conn.close();
});

/** 单块变量数上限（含固定变量 sessionId）。与仓储里 `IN_LIST_MAX_VARS` 同值。 */
const MAX_VARS_PER_CHUNK = 900;

/** 主差分夹具规模：1200 > 900 ⇒ 必然切成 ≥2 块。 */
const BIG_ID_COUNT = 1200;

// ---------------------------------------------------------------------------
// 观测面：记「每次调用的绑定参数个数」
// ---------------------------------------------------------------------------

interface BindingTrace {
  readonly sql: string;
  readonly paramCount: number;
}

/** 给连接套一层记录绑定参数个数的探针（SQL 文本也留一份便于定位）。 */
function bindingProbe(inner: TdbcConnection): {
  readonly conn: TdbcConnection;
  readonly trace: readonly BindingTrace[];
  reset: () => void;
} {
  const trace: BindingTrace[] = [];
  const wrap = (target: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      trace.push({ sql: sql.trim(), paramCount: parameters?.length ?? 0 });
      return target.execute(sql, parameters);
    },
    query: <R extends Row = Row>(sql: string, parameters?: readonly unknown[]) => {
      trace.push({ sql: sql.trim(), paramCount: parameters?.length ?? 0 });
      return target.query<R>(sql, parameters);
    },
    batch: (sql, parametersList) => {
      trace.push({
        sql: sql.trim(),
        // batch 按「一次调用」计，取单组长度代表该组的变量数。
        paramCount: parametersList[0]?.length ?? 0,
      });
      return target.batch(sql, parametersList);
    },
    transaction: <U>(fn: (tx: TdbcConnection) => Promise<U>) =>
      target.transaction(fn),
    close: () => target.close(),
  });
  return {
    conn: wrap(inner),
    trace,
    reset: () => {
      trace.length = 0;
    },
  };
}

/** 只留消息读口相关的调用（COUNT / SELECT / DELETE FROM message_checkpoint*）。 */
function checkpointCalls(
  trace: readonly BindingTrace[]
): readonly BindingTrace[] {
  return trace.filter((t) => /message_checkpoint/i.test(t.sql));
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 一条真实 vfs revision（entryId + version），供 message_checkpoint_file 指向。 */
interface RevisionPointer {
  readonly entryId: number;
  readonly version: number;
}

interface Fixture {
  readonly sessionId: string;
  /** 全部消息 id（长度 = count）。 */
  readonly messageIds: readonly string[];
  /** 带文件指针的消息数（文件指针挂在最前面的这些 id 上）。 */
  readonly pointerCount: number;
}

/**
 * 造 count 条 checkpoint 锚点行；其中前 pointerCount 条各挂一个文件指针，
 * 并把对应 `vfs_revision.ref_count` +1（复刻 capture 的持有形态）。
 */
async function seedCheckpoints(
  projectId: string,
  sessionId: string,
  count: number,
  pointerCount: number
): Promise<Fixture> {
  const svfs = ctx.sessionVfs(projectId, sessionId);
  const entries = new SqliteVfsEntryRepository(ctx.conn);
  const revisions = new SqliteVfsRevisionRepository(ctx.conn);
  const sk = scopeKey({ kind: "session", projectId, sessionId });

  // 真实 revision（文件指针必须有指向，否则 delete 时的 ref 减一没有对账面）。
  const pointers: RevisionPointer[] = [];
  for (let i = 0; i < pointerCount; i++) {
    const p = `/ck-${i}.md`;
    await svfs.write(p, `body-${i}`, { versionCheck: false });
    const entry = await entries.findByPath(sk, p);
    const version = (await svfs.read(p)).version;
    pointers.push({ entryId: entry!.entryId, version });
  }

  const messageIds: string[] = [];
  const anchorRows: unknown[][] = [];
  const fileRows: unknown[][] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const id = `ck-msg-${testIsolationSuffix()}-${i}`;
    messageIds.push(id);
    anchorRows.push([sessionId, id, now + i]);
    if (i < pointerCount) {
      fileRows.push([
        sessionId,
        id,
        pointers[i]!.entryId,
        pointers[i]!.version,
        `/ck-${i}.md`,
      ]);
    }
  }

  // 分批裸 INSERT（不进生产写路径：本用例只验 IN 列表分块，不验 seed）。
  for (let off = 0; off < anchorRows.length; off += 500) {
    const part = anchorRows.slice(off, off + 500);
    await ctx.conn.execute(
      `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms)
       VALUES ${part.map(() => "(?, ?, ?)").join(", ")}`,
      part.flat(),
    );
  }
  for (let off = 0; off < fileRows.length; off += 500) {
    const part = fileRows.slice(off, off + 500);
    await ctx.conn.execute(
      `INSERT INTO message_checkpoint_file
         (session_id, message_id, entry_id, revision_version, path)
       VALUES ${part.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
      part.flat(),
    );
  }
  // 文件指针的 revision 各 +1（复刻 capture 的持有形态，delete 时要能对账）。
  await revisions.batchAdjustRefCount(pointers, +1);

  return { sessionId, messageIds, pointerCount };
}

/** 读一组 revision 的 ref_count（key 化便于对账）。 */
async function refCountSnapshot(
  pointers: readonly RevisionPointer[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const p of pointers) {
    const rows = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [p.entryId, p.version]
    );
    out.set(`${p.entryId}:${p.version}`, Number(rows[0]?.ref_count ?? 0));
  }
  return out;
}

/** 锚点行 / 文件指针行的剩余条数。 */
async function remainingRows(sessionId: string): Promise<{
  anchors: number;
  files: number;
}> {
  const a = await ctx.conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM message_checkpoint WHERE session_id = ?`,
    [sessionId]
  );
  const f = await ctx.conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM message_checkpoint_file WHERE session_id = ?`,
    [sessionId]
  );
  return { anchors: Number(a[0]!.n), files: Number(f[0]!.n) };
}

// ---------------------------------------------------------------------------
// I3：主差分断言（1200 id ⇒ ≥2 块，任一块绑定变量 ≤900）
// ---------------------------------------------------------------------------

describe("C2-9 I3: 1200 个 id ⇒ 至少 2 块且任一块绑定变量 ≤ 900", () => {
  it("T-CHUNK-I3-COUNT: countCheckpointsForMessages 分块且每块 ≤900 变量", async () => {
    const project = await ctx.projects.create(`P-c2i3a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const fx = await seedCheckpoints(project.id, session.id, BIG_ID_COUNT, 0);

    const probe = bindingProbe(ctx.conn);
    const repo = new SqliteMessageCheckpointRepository(probe.conn);
    probe.reset();
    const total = await repo.countCheckpointsForMessages(fx.sessionId, fx.messageIds);

    assert.equal(total, BIG_ID_COUNT, "分块求和 == 整段计数");

    const calls = checkpointCalls(probe.trace);
    assert.ok(
      calls.length >= 2,
      `1200 个 id 必须切成 ≥2 块，实际 ${calls.length} 块（旧实现一条语句即过，I3 无牙）`
    );
    for (const call of calls) {
      assert.ok(
        call.paramCount <= MAX_VARS_PER_CHUNK,
        `某块绑了 ${call.paramCount} 个变量，超过 ${MAX_VARS_PER_CHUNK}：${call.sql.slice(0, 120)}`
      );
    }
  });

  it("T-CHUNK-I3-LIST: listFilePointersForMessages 分块且每块 ≤900 变量", async () => {
    const project = await ctx.projects.create(`P-c2i3b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const fx = await seedCheckpoints(project.id, session.id, BIG_ID_COUNT, 300);

    const probe = bindingProbe(ctx.conn);
    const repo = new SqliteMessageCheckpointRepository(probe.conn);
    probe.reset();
    const pointers = await repo.listFilePointersForMessages(
      fx.sessionId,
      fx.messageIds
    );

    assert.equal(pointers.length, 300, "文件指针一条不少");

    const calls = checkpointCalls(probe.trace);
    assert.ok(calls.length >= 2, `list 侧必须切成 ≥2 块，实际 ${calls.length}`);
    for (const call of calls) {
      assert.ok(
        call.paramCount <= MAX_VARS_PER_CHUNK,
        `某块绑了 ${call.paramCount} 个变量，超过 ${MAX_VARS_PER_CHUNK}`
      );
    }
  });

  it("T-CHUNK-I3-DELETE: deleteCheckpointsForMessages 分块且每块 ≤900 变量", async () => {
    const project = await ctx.projects.create(`P-c2i3c-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const fx = await seedCheckpoints(project.id, session.id, BIG_ID_COUNT, 300);

    const probe = bindingProbe(ctx.conn);
    const repo = new SqliteMessageCheckpointRepository(probe.conn);
    probe.reset();
    await repo.deleteCheckpointsForMessages(fx.sessionId, fx.messageIds);

    const calls = checkpointCalls(probe.trace);
    assert.ok(
      calls.length >= 2,
      `delete 侧必须切成 ≥2 块，实际 ${calls.length}（读 + 两条 DELETE 都按块走）`
    );
    for (const call of calls) {
      assert.ok(
        call.paramCount <= MAX_VARS_PER_CHUNK,
        `某块绑了 ${call.paramCount} 个变量，超过 ${MAX_VARS_PER_CHUNK}`
      );
    }
    assert.deepEqual(await remainingRows(fx.sessionId), { anchors: 0, files: 0 });
  });
});

// ---------------------------------------------------------------------------
// I2：结果等价（整段 == 分段）
// ---------------------------------------------------------------------------

describe("C2-9 I2: 分块结果与整段结果等价", () => {
  it("T-CHUNK-I2: 计数 / 指针序列 / 删除后剩余行与 ref_count 三项都对得上", async () => {
    const project = await ctx.projects.create(`P-c2i2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const fx = await seedCheckpoints(project.id, session.id, BIG_ID_COUNT, 300);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);

    // ① 计数：整段一次 vs 拆成 900 + 300 两次。
    const whole = await repo.countCheckpointsForMessages(fx.sessionId, fx.messageIds);
    const splitA = await repo.countCheckpointsForMessages(
      fx.sessionId,
      fx.messageIds.slice(0, 900)
    );
    const splitB = await repo.countCheckpointsForMessages(
      fx.sessionId,
      fx.messageIds.slice(900)
    );
    assert.equal(whole, BIG_ID_COUNT);
    assert.equal(splitA + splitB, whole, "分段计数之和 == 整段计数");

    // ② 文件指针：行集合与**顺序**都一致（块顺序 == id 顺序）。
    const wholePointers = await repo.listFilePointersForMessages(
      fx.sessionId,
      fx.messageIds
    );
    const splitPointers = [
      ...(await repo.listFilePointersForMessages(
        fx.sessionId,
        fx.messageIds.slice(0, 900)
      )),
      ...(await repo.listFilePointersForMessages(
        fx.sessionId,
        fx.messageIds.slice(900)
      )),
    ];
    assert.deepEqual(
      splitPointers.map((p) => `${p.messageId}:${p.entryId}:${p.revisionVersion}`),
      wholePointers.map((p) => `${p.messageId}:${p.entryId}:${p.revisionVersion}`),
      "分段指针序列（含顺序）必须与整段逐项一致"
    );

    // ③ 删除：剩余行集合归零，且每条 revision 的 ref_count 精确 −1。
    const entryIds = wholePointers.map((p) => ({
      entryId: p.entryId,
      version: p.revisionVersion,
    }));
    const before = await refCountSnapshot(entryIds);
    for (const [key, value] of before) {
      assert.ok(value > 0, `前置：revision ${key} 的 ref_count 应为正，实际 ${value}`);
    }

    await repo.deleteCheckpointsForMessages(fx.sessionId, fx.messageIds);

    assert.deepEqual(await remainingRows(fx.sessionId), { anchors: 0, files: 0 });
    const after = await refCountSnapshot(entryIds);
    for (const [key, value] of before) {
      assert.equal(
        after.get(key),
        value - 1,
        `revision ${key} 的 ref_count 应精确 −1`
      );
    }
  });

  it("T-CHUNK-I2-DUP: 含重复 id 的列表与整段版一致（求和语义不因分块而变）", async () => {
    // spec C2-9 风险 R1 的缓解措施：求和语义在有重复 id 时会「偏大」，
    // 但调用方的 id 来自 chat_message 主键、无重复 ⇒ 语义**不因分块而变**。
    // 本条钉住这一点：同一个含重复的列表，分块前后结果必须一致。
    const project = await ctx.projects.create(`P-c2i2d-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const fx = await seedCheckpoints(project.id, session.id, 1000, 0);

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    const withDup = [...fx.messageIds, ...fx.messageIds.slice(0, 200)];
    const whole = await repo.countCheckpointsForMessages(fx.sessionId, withDup);
    const split =
      (await repo.countCheckpointsForMessages(fx.sessionId, withDup.slice(0, 900))) +
      (await repo.countCheckpointsForMessages(fx.sessionId, withDup.slice(900)));

    assert.equal(whole, 1200, "1000 条锚点 + 200 条重复 ⇒ 整段求和 1200");
    assert.equal(split, whole, "分段求和 == 整段求和（重复 id 语义不因分块而变）");
  });
});

// ---------------------------------------------------------------------------
// I4：边界档位
// ---------------------------------------------------------------------------

describe("C2-9 I4: 边界档位 0 / 1 / 899 / 900 / 901", () => {
  it("T-CHUNK-I4: 0 个 id 早退不发 SQL；其余档位切块正确且结果一致", async () => {
    const project = await ctx.projects.create(`P-c2i4-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const fx = await seedCheckpoints(project.id, session.id, 1001, 0);

    // 0：三个方法都早退，一条 SQL 都不许发。
    const probe = bindingProbe(ctx.conn);
    const zeroRepo = new SqliteMessageCheckpointRepository(probe.conn);
    probe.reset();
    assert.equal(await zeroRepo.countCheckpointsForMessages(fx.sessionId, []), 0);
    assert.deepEqual(
      await zeroRepo.listFilePointersForMessages(fx.sessionId, []),
      []
    );
    await zeroRepo.deleteCheckpointsForMessages(fx.sessionId, []);
    assert.deepEqual(
      checkpointCalls(probe.trace),
      [],
      "零 id 必须早退、不发任何 SQL（不得落一条空 IN 查询）"
    );

    // 1 / 899 / 900 / 901：结果恒等于「实际存在的锚点数」，且每块 ≤900 变量。
    for (const size of [1, 899, 900, 901] as const) {
      const ids = fx.messageIds.slice(0, size);
      const p = bindingProbe(ctx.conn);
      const r = new SqliteMessageCheckpointRepository(p.conn);
      p.reset();
      const n = await r.countCheckpointsForMessages(fx.sessionId, ids);
      assert.equal(n, size, `${size} 个 id：计数应恰为 ${size}`);
      for (const call of checkpointCalls(p.trace)) {
        assert.ok(
          call.paramCount <= MAX_VARS_PER_CHUNK,
          `${size} 个 id 档位出现 ${call.paramCount} 变量的块`
        );
      }
    }

    // 901 是唯一的「刚好跨块」档位：必须切成 2 块。
    const p901 = bindingProbe(ctx.conn);
    const r901 = new SqliteMessageCheckpointRepository(p901.conn);
    p901.reset();
    await r901.countCheckpointsForMessages(fx.sessionId, fx.messageIds.slice(0, 901));
    const calls901 = checkpointCalls(p901.trace);
    assert.equal(
      calls901.length,
      2,
      `901 个 id（块容量 899）应切成 2 块，实际 ${calls901.length}`
    );
    assert.deepEqual(
      calls901.map((c) => c.paramCount).sort((a, b) => b - a),
      [900, 3],
      "两块变量数应为 900（899 id + sessionId）与 3（2 id + sessionId）"
    );

    // 900 恰好一块（块容量 899 ⇒ 900 必切两块；这里断言的是 899 一块）。
    const p899 = bindingProbe(ctx.conn);
    const r899 = new SqliteMessageCheckpointRepository(p899.conn);
    p899.reset();
    await r899.countCheckpointsForMessages(fx.sessionId, fx.messageIds.slice(0, 899));
    assert.equal(
      checkpointCalls(p899.trace).length,
      1,
      "899 个 id 恰好一块（块容量 = 900 − 1 个 sessionId）"
    );
  });
});