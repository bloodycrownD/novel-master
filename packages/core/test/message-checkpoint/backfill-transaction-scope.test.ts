/**
 * CS-05b backfill 移出事务的验收（fix-spec/wave-c2.md §C2-2 B1/B2/B3/B5）。
 *
 * 结构：段 0（短路判定）+ 段 1（定位空窗 + 取指针快照）**在事务外、只读**；
 * 段 2 是只装补写语句的短事务。观测面是「事务调用次数」与「某条事务内的语句
 * 条数」——RULE 明禁 `spyListBySession` 这类读口一换就静默失效的观测面。
 *
 * 旧形态（判定 + 全量扫描 + 补写同在一条事务）下：
 * - 短路路径事务数 ≥1（本文件断言 0）⇒ 有牙；
 * - 补写路径事务内的语句数随**消息总数 M** 线性增长（本文件断言与 M 无关）⇒ 有牙。
 *
 * @module test/message-checkpoint/backfill-transaction-scope
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createScopedVfsService, createVfsZipIoService } from "@novel-master/core/vfs";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import type { WorkplaceDirRule } from "@/domain/workplace/model/workplace-types.js";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { createMessageCheckpointService } from "@novel-master/core/message-checkpoint";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  openNovelMasterTestConnection,
  type NovelMasterTestContext,
} from "../helpers/novel-master.js";
import {
  probeTransactions,
  type TransactionProbe,
} from "../helpers/transaction-probe.js";

function filesMap(count: number, prefix = "f"): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    map.set(
      `${prefix}${String(i).padStart(4, "0")}.md`,
      `body-${prefix}-${i}-正文`
    );
  }
  return map;
}

/** 装一个 session + n 条消息，返回最后一个消息 id。 */
async function seedSession(
  ctx: NovelMasterTestContext,
  conn: TdbcConnection,
  label: string,
  messageCount: number
): Promise<{ projectId: string; sessionId: string; lastMessageId: string }> {
  const project = await ctx.projects.create(`P-${label}-${Date.now()}`);
  const session = await ctx.sessions.create(project.id);
  const vfs = createScopedVfsService(conn, {
    kind: "session",
    projectId: project.id,
    sessionId: session.id,
  });
  await vfs.write("/anchor.md", "anchor", { versionCheck: false });
  let lastId = "";
  for (let i = 0; i < messageCount; i++) {
    lastId = (
      await ctx.messages.append(session.id, i % 2 === 0 ? "user" : "assistant", {
        blocks: [{ type: "text", text: `m${i}` }],
      })
    ).id;
  }
  return { projectId: project.id, sessionId: session.id, lastMessageId: lastId };
}

describe("CS-05b backfill 事务边界", () => {
  let ctx: NovelMasterTestContext;
  let conn: TdbcConnection;
  let probe: TransactionProbe;

  before(async () => {
    ctx = await openNovelMasterTestConnection();
    const probed = probeTransactions(ctx.conn);
    conn = probed.conn;
    probe = probed.probe;
  });

  after(async () => {
    await ctx.conn.close();
  });

  it("B1: 450 文件 session 导入 → backfill 独立成一条事务且事务内零 vfs_entry 写", async () => {
    const seeded = await seedSession(ctx, conn, "b1", 2);
    const scope = {
      kind: "session" as const,
      projectId: seeded.projectId,
      sessionId: seeded.sessionId,
    };

    probe.reset();
    await createVfsZipIoService(conn).import(scope, buildVfsZip(filesMap(450)), {
      confirmed: true,
    });

    // 段 B0 ×1 + 文件片 ×3 + 段 R ×1 + backfill ×1 = 6。
    assert.equal(probe.transactionCount, 6);

    // ⚠ 不能用 `probe.transactionCount - 1`（cr1-ctests P2-4b）：那把「backfill
    // 段必是最后一条事务」这个**段序前提**写进了断言。当前段序（B0 → 文件片 →
    // R → backfill）下成立，将来若把段 R 挪到 backfill 之后就会假红，而且报错
    // 信息会指向完全错误的业务语义。改为按内容定位。
    const backfillTxIndexes = Array.from(
      { length: probe.transactionCount },
      (_, i) => i
    ).filter((i) =>
      probe
        .statementsInTransaction(i)
        .some((s) => s.sql.includes("message_checkpoint"))
    );
    assert.equal(
      backfillTxIndexes.length,
      1,
      "backfill 段必须是且只能是单独一条事务（按内容定位，不依赖段序）"
    );
    const inBackfill = probe.statementsInTransaction(backfillTxIndexes[0]!);
    assert.ok(
      inBackfill.some((s) => /INSERT INTO\s+message_checkpoint/i.test(s.sql)),
      "backfill 段必须真的在补 checkpoint 行"
    );
    // ⚠️ 断言口径是「零 vfs_entry **写**」：导入侧段 C 按 spec 的形态就是
    // `conn.transaction(backfillBaselineCheckpoints)`——判定/扫描读（列表 vfs_entry
    // + 头投影 + JOIN 定位）仍在**这条**短事务内。要治的是「它们与 3 万条导入语句
    // 同一条事务」，不是「这段读必须零事务」。
    const entryWrites = inBackfill.filter((s) =>
      /(INSERT INTO|UPDATE|DELETE FROM)\s+vfs_entry/i.test(s.sql)
    );
    assert.equal(
      entryWrites.length,
      0,
      "backfill 段事务内零 vfs_entry 写（旧形态下这里是 450 个文件的导入写）"
    );
    // 对照组：文件片里 vfs_entry 写是实打实的 ⇒ 断言不是恒真。
    assert.ok(countVfsEntryWrites(probe, 1) > 0);

    // 补写确实生效（段 C 没被跳过）。
    const rows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM message_checkpoint WHERE session_id = ?`,
      [seeded.sessionId]
    );
    assert.ok(Number(rows[0]!.n) >= 2);
  });

  it("B2: 段 R 故障（createWorkplaceRepo 抛）不阻断导入，新内容完整、规则表无脏行", async () => {
    const seeded = await seedSession(ctx, conn, "b2r", 2);
    const scope = {
      kind: "session" as const,
      projectId: seeded.projectId,
      sessionId: seeded.sessionId,
    };
    // 夹具必须带**子目录**：ensure-import-dir-rules 的内核第一句就是
    // `if (logicalPath === "/") continue`（根自身不补规则行），全根目录的
    // 夹具会让 upsertDirRule 零调用、注入的抛错一次都没执行，本条用例退化成
    // 「导入成功 + 规则表空」——把整个 ensureImportDirRules 调用删掉也照样绿。
    // 两个子目录是为了让「第一条成功写、第二条抛」这条形态可构造（单子目录
    // 只能触发一次调用，造不出 N-1 已落库 + 末条失败的半截场景）。
    const expected = filesMap(20);
    expected.set("sub/x.md", "body-sub-x");
    expected.set("sub2/y.md", "body-sub2-y");

    let upsertCalls = 0;
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      const zipSvc = createVfsZipIoService(conn, {
        testHook: {
          createWorkplaceRepo: (tx) => {
            const real = new SqliteWorkplaceRepository(tx);
            return {
              listDirRules: (scopeKey: string) => real.listDirRules(scopeKey),
              // 形态：第一条真写（走真实 upsert，落一条完整行），第二条才抛。
              // 「一调就抛」造不出 spec 要验的东西——那样「无脏行」是 mock 自己
              // 什么都没写的保证，不是被测代码「失败不留半截行」的性质。
              upsertDirRule: async (rule: WorkplaceDirRule) => {
                upsertCalls += 1;
                if (upsertCalls === 1) {
                  await real.upsertDirRule(rule);
                  return;
                }
                await tx.execute(
                  "INSERT INTO no_such_table_boom (id) VALUES (1)"
                );
              },
            } as unknown as WorkplaceRepository;
          },
        },
      });

      await assert.doesNotReject(() =>
        zipSvc.import(scope, buildVfsZip(expected), { confirmed: true })
      );
    } finally {
      console.warn = originalWarn;
    }

    // 牙齿判据①：注入必须真的被触发，否则本条全部断言恒真。
    assert.equal(
      upsertCalls,
      2,
      "夹具带子目录 ⇒ upsertDirRule 应被调用两次（一条成功 + 一条抛）"
    );
    // 牙齿判据②：best-effort 失败必须留痕（spec B2 验收项「日志含 warn」）。
    assert.ok(
      warns.some((w) => String(w[0]).includes("ensureImportDirRules")),
      "补规则行失败必须被吞掉并记 warn（含 ensureImportDirRules 前缀）"
    );

    const vfs = createScopedVfsService(conn, scope);
    const entries = new SqliteVfsEntryRepository(conn);
    for (const [rel, content] of expected) {
      assert.equal((await vfs.read(`/${rel}`)).content, content);
    }
    const rows = await entries.scanContents(
      `session:${seeded.projectId}:${seeded.sessionId}`,
      "/"
    );
    assert.equal(rows.length, expected.size);

    // ⚠️ `WHERE scope_key = session:<sid>` 是 **workplace 键空间**
    // （workplaceScopeKey），与 vfs 侧的 `session:<pid>:<sid>` 是两套键空间
    // （见 ensure-import-dir-rules.ts:87-89）——这里不要「顺手统一」成 vfs 键，
    // 那样查的是另一张表的另一批行，断言会静默失效。
    const rules = await ctx.conn.query<{ logical_path: string }>(
      `SELECT logical_path FROM workplace_dir_rule
       WHERE scope_key = ?
       ORDER BY logical_path`,
      [`session:${seeded.sessionId}`]
    );
    assert.equal(
      rules.length,
      1,
      `规则表只应留下第一条成功写入的行，失败的第二条不得留残行（实际 ${JSON.stringify(
        rules.map((r) => r.logical_path),
      )}）`
    );
    assert.notEqual(
      rules[0]!.logical_path,
      "/",
      "根自身由内核跳过、不补规则行，留下的必须是子目录行"
    );
  });

  it("B2: backfill 段自身抛错也不阻断导入（best-effort + warn）", async () => {
    const seeded = await seedSession(ctx, conn, "b2b", 2);
    const scope = {
      kind: "session" as const,
      projectId: seeded.projectId,
      sessionId: seeded.sessionId,
    };
    const expected = filesMap(20);

    // 只让 backfill 的补写语句真失败：ABORT 掉 message_checkpoint 的 INSERT。
    // 不需要给生产代码加钩子——段 C 唯一会碰这张表的就是补写。
    await ctx.conn.execute(
      `CREATE TRIGGER t_block_backfill_insert
       BEFORE INSERT ON message_checkpoint
       BEGIN SELECT RAISE(ABORT, 'backfill blocked'); END`
    );
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      await assert.doesNotReject(() =>
        createVfsZipIoService(conn).import(
          scope,
          buildVfsZip(expected),
          { confirmed: true }
        )
      );
    } finally {
      console.warn = originalWarn;
      await ctx.conn.execute(`DROP TRIGGER IF EXISTS t_block_backfill_insert`);
    }

    assert.ok(
      warns.some((w) => String(w[0]).includes("baseline checkpoint backfill failed")),
      "backfill 失败必须被吞掉并记 warn（不得冒泡成 IMPORT_FAILED）"
    );
    // 新内容逐字节完整（导入是全量覆盖语义，但补写失败不影响任何一条导入语句）。
    const vfs = createScopedVfsService(conn, scope);
    for (const [rel, content] of expected) {
      assert.equal((await vfs.read(`/${rel}`)).content, content);
    }
    const rows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM message_checkpoint WHERE session_id = ?`,
      [seeded.sessionId]
    );
    assert.equal(Number(rows[0]!.n), 0, "被 ABORT 的补写不得留下半截 checkpoint");
  });

  it("B3: 无空窗短路路径 —— 段 0/段 1 事务外 ⇒ 事务调用数为 0", async () => {
    const seeded = await seedSession(ctx, conn, "b3short", 2);
    const checkpoint = createMessageCheckpointService(conn);

    // 第一轮：建游标（游标缺失 ⇒ 判定回退全量，会开一条写事务写游标）。
    await checkpoint.backfillMissingBaselines(seeded.sessionId, seeded.projectId);
    probe.reset();
    // 第二轮：count === 游标 ⇒ 短路。段 0 的判定、游标写入都是单条语句，
    // 整条路径**不开事务**。
    await checkpoint.backfillMissingBaselines(seeded.sessionId, seeded.projectId);
    assert.equal(
      probe.transactionCount,
      0,
      "短路路径零事务（旧形态下判定在事务内 ⇒ 必红）"
    );
    assert.ok(
      probe.statementsOutsideTransactions().some((s) => s.sql.includes("message_checkpoint")),
      "短路判定确实读了 checkpoint 表（断言不是恒真）"
    );
  });

  it("B3: 有空窗补写路径 —— 只有段 2 一条事务，事务内语句数与消息总数 M 无关", async () => {
    const checkpoint = createMessageCheckpointService(conn);

    // 两条会话：gap 都是最后 3 条，但消息总数分别是 4 与 200。
    const small = await seedSession(ctx, conn, "b3m4", 4);
    const smallAnchor = (
      await ctx.messages.listBySession(small.sessionId)
    )[0]!;
    await checkpoint.capture(
      small.sessionId,
      small.projectId,
      smallAnchor.id
    );

    const big = await seedSession(ctx, conn, "b3m200", 200);
    const bigAnchor = (await ctx.messages.listBySession(big.sessionId))[196]!;
    await checkpoint.capture(big.sessionId, big.projectId, bigAnchor.id);

    probe.reset();
    await checkpoint.backfillMissingBaselines(small.sessionId, small.projectId);
    assert.equal(probe.transactionCount, 1, "补写路径恰好一条短事务（段 2）");
    const smallStmts = probe.statementCountInTransaction(0);

    probe.reset();
    await checkpoint.backfillMissingBaselines(big.sessionId, big.projectId);
    assert.equal(probe.transactionCount, 1, "补写路径恰好一条短事务（段 2）");
    const bigStmts = probe.statementCountInTransaction(0);

    // 主差分断言：gap 长度相同（都是 3）、M 差 50 倍 ⇒ 写事务内语句数必须相等。
    // 旧形态下这段扫描在事务内，是 O(M) 次单行读 ⇒ 必红。
    assert.equal(
      bigStmts,
      smallStmts,
      `事务内语句数必须只与 gap(3) 相关：M=4 时 ${smallStmts}，M=200 时 ${bigStmts}`
    );
    assert.ok(smallStmts > 0);
  });

  it("B5: 连跑两轮 backfill —— 第二轮不新增 checkpoint 行（幂等）", async () => {
    const seeded = await seedSession(ctx, conn, "b5", 5);
    const checkpoint = createMessageCheckpointService(conn);

    const countRows = async (): Promise<number> => {
      const rows = await ctx.conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM message_checkpoint WHERE session_id = ?`,
        [seeded.sessionId]
      );
      return Number(rows[0]!.n);
    };

    await checkpoint.backfillMissingBaselines(seeded.sessionId, seeded.projectId);
    const afterFirst = await countRows();
    assert.ok(afterFirst > 0, "第一轮应当补上 checkpoint");

    await checkpoint.backfillMissingBaselines(seeded.sessionId, seeded.projectId);
    const afterSecond = await countRows();
    assert.equal(afterSecond, afterFirst, "第二轮不得新增行（insertCheckpoint 是替换语义）");

    // 第三轮：游标已前移 ⇒ 走短路，仍不得新增。
    await checkpoint.backfillMissingBaselines(seeded.sessionId, seeded.projectId);
    assert.equal(await countRows(), afterFirst);
  });
});

function countVfsEntryWrites(probe: TransactionProbe, txIndex: number): number {
  return probe
    .statementsInTransaction(txIndex)
    .filter((s) => /INSERT INTO vfs_entry/i.test(s.sql)).length;
}