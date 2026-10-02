/**
 * CS-05 导入分片提交的验收（fix-spec/wave-c2.md §C2-1 A1/A2/A3/A4/A6 + 测试策略三条）。
 *
 * 观测面一律是**计数式**（事务调用次数 / 单事务内语句条数 / 直查表行数）——
 * RULE 明禁「拿墙钟卡线」，也明禁 `spyListBySession` 这类「读口一换就静默失效」
 * 的观测面。旧形态（整批一条事务）在同样断言下事务数是 3（段 B0 + 一条大事务 +
 * 段 R），本文件全部用例在旧形态下必红 ⇒ 有牙。
 *
 * @module test/vfs/vfs-import-shard
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createScopedVfsService,
  createVfsZipIoService,
  VfsZipError,
} from "@novel-master/core/vfs";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK } from "../../src/domain/vfs/logic/vfs-import-chunk.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { isVfsError } from "../../src/errors/vfs-errors.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  openNovelMasterTestConnection,
  type NovelMasterTestContext,
} from "../helpers/novel-master.js";
import {
  probeTransactions,
  type TransactionProbe,
} from "../helpers/transaction-probe.js";

/** 分片大小上界（与实现共用常量，防止测试悄悄跟实现漂移）。 */
const CHUNK = ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK;

/** 单个文件在一条分片事务内的语句条数上界（findByPath ×3 + 落 entry/blob/revision + adjustRef）。 */
const STATEMENTS_PER_FILE_UPPER_BOUND = 15;

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

function filesMap(count: number, prefix = "f"): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    map.set(`${prefix}${pad(i)}.md`, `body-${prefix}-${i}-正文`);
  }
  return map;
}

function countSql(probe: TransactionProbe, txIndex: number, needle: string): number {
  return probe
    .statementsInTransaction(txIndex)
    .filter((s) => s.sql.includes(needle)).length;
}

describe("CS-05 导入分片提交（vfs-zip-io）", () => {
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

  it("A1: 450 文件 = 段 B0 ×1 + 文件片 ×3 + 段 R ×1，恰好 5 条事务", async () => {
    const project = await ctx.projects.create(`P-a1-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };

    probe.reset();
    await createVfsZipIoService(conn).import(
      scope,
      buildVfsZip(filesMap(450)),
      { confirmed: true }
    );

    // 牙齿：旧形态（整批一条事务）这里是 3；中间那片数随 CHUNK 改而变。
    assert.equal(probe.transactionCount, 5);
    assert.equal(
      Math.ceil(450 / CHUNK),
      3,
      "450 / 200 必须是 3 片（分片大小常量被改也会红）"
    );
    // 段 B0（索引 0）不写文件：只有删前缀 + 目录行。
    assert.equal(countSql(probe, 0, "INSERT INTO vfs_entry"), 0);
    // 段 R（最后一条索引）只碰 workplace_dir_rule，不写 vfs 表。
    const last = probe.transactionCount - 1;
    assert.equal(countSql(probe, last, "INSERT INTO vfs_entry"), 0);
  });

  it("A2: 任一文件片内 insertFileSeedingRevision 调用次数 ≤ 200", async () => {
    const project = await ctx.projects.create(`P-a2-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };

    probe.reset();
    await createVfsZipIoService(conn).import(
      scope,
      buildVfsZip(filesMap(450)),
      { confirmed: true }
    );

    // 每个文件恰好一条 vfs_revision（insertFileSeedingRevision 的 append）⇒
    // 「revision 行数 == 片内文件数」即「该片调用次数」，不必去 spy 模块函数。
    const perShard = [1, 2, 3].map((i) => countSql(probe, i, "INSERT INTO vfs_revision"));
    assert.deepEqual(perShard, [200, 200, 50]);
    for (const n of perShard) {
      assert.ok(n <= CHUNK, `单片不得超过 ${CHUNK} 个文件`);
    }
    const total = perShard.reduce((a, b) => a + b, 0);
    assert.equal(total, 450, "450 个文件必须全部落 revision，不许漏");
  });

  it("A3: 分片数与落库集合/正文无关（450 文件逐条比对）", async () => {
    const project = await ctx.projects.create(`P-a3-${Date.now()}`);
    const scopeKey = `project:${project.id}`;
    const expected = filesMap(450);

    await createVfsZipIoService(conn).import(
      { kind: "project", projectId: project.id },
      buildVfsZip(expected),
      { confirmed: true }
    );

    const rows = await new SqliteVfsEntryRepository(conn).scanContents(scopeKey, "/");
    const actual = new Map(rows.map((r) => [r.path, r.content]));
    assert.equal(actual.size, 450);
    for (const [path, content] of expected) {
      assert.equal(actual.get(`/${path}`), content, `${path} 正文应逐字节一致`);
    }
  });

  it("A4/钩子: 第 3 片注入既有钩子 → 抛原始 Error、半棵新树被补偿、旧内容不恢复", async () => {
    const project = await ctx.projects.create(`P-a4hook-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const vfs = createScopedVfsService(conn, scope);
    await vfs.write("/before.md", "旧内容");

    const files = filesMap(450);
    // 第 3 片（0-based 第 2 片）的首个文件。
    const failPath = "/f0200.md";
    await assert.rejects(
      () =>
        createVfsZipIoService(conn, {
          testHook: { throwOnInsertLogical: failPath },
        }).import(scope, buildVfsZip(files), { confirmed: true }),
      (e: unknown) =>
        // 测试钩子直抛分支绕过了 IMPORT_FAILED 包装 ⇒ 断言必须是原始 Error。
        e instanceof Error && e.message === "test import failure"
    );

    // 前 2 片的文件已被补偿删除（补偿挂在片失败的内层，不挂外层 catch）。
    await assert.rejects(
      () => vfs.read("/f0000.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND")
    );
    await assert.rejects(
      () => vfs.read("/f0199.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND")
    );
    // 失败片本身未落库。
    await assert.rejects(
      () => vfs.read(failPath),
      (e: unknown) => isVfsError(e, "NOT_FOUND")
    );
    // 旧内容**不恢复**（段 B0 已删，补偿只清半棵新树）——这是分片的既定行为损失。
    await assert.rejects(
      () => vfs.read("/before.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND")
    );

    // 补偿用 releaseAndDeleteVfsPrefix（减 live ref + 删 entry + GC 无引用 revision）
    // ⇒ 该前缀下零 revision 残留。裸 deleteVfsPrefix 会留下一批 ref_count=1 的
    // 孤儿 revision ⇒ 这条断言是「口径写死」那颗牙齿。
    const orphans = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_revision
       WHERE entry_id NOT IN (SELECT entry_id FROM vfs_entry)`
    );
    assert.equal(Number(orphans[0]!.n), 0, "补偿后不得有孤儿 vfs_revision 行");
    // ⚠️ 这里**不**断言 blob 零残留：`sweepRevisionsUnderScope` 的固定顺序是
    // 「减 live ref → GC revision → 删 entry」，revision 被删的那一刻 entry 还在
    // ⇒ CS-07 守卫（宁可留垃圾不可丢数据）会保留该 blob。这是已登记的
    // 「存储缓慢增长」已知限制（见 vfs-gc-trigger.test.ts 的同款说明），
    // 本条验收只钉「revision 零残留」。
  });

  it("A4/真实失败: 非钩子失败 → IMPORT_FAILED 且消息带分片进度", async () => {
    const project = await ctx.projects.create(`P-a4real-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const vfs = createScopedVfsService(conn, scope);

    // 文件序：先 200 个正常文件（第 1 片），再「a.md」+「a.md/b.md」。
    // 第二片的第二条让 ensureParentDirectories 撞上「父路径是文件行」⇒ 真实
    // 语句级失败（不是测试钩子）。
    const files = filesMap(200, "ok");
    files.set("a.md", "A");
    files.set("a.md/b.md", "B");

    await assert.rejects(
      () =>
        createVfsZipIoService(conn).import(
          scope,
          buildVfsZip(files),
          { confirmed: true }
        ),
      (e: unknown) =>
        e instanceof VfsZipError &&
        e.code === "IMPORT_FAILED" &&
        e.message.includes("已提交 1 片") &&
        e.message.includes("失败在第 2 片")
    );

    // 补偿照跑：目标前缀回到「空的可重试态」。
    await assert.rejects(
      () => vfs.read("/a.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND")
    );
    const remaining = await vfs.list("/", { recursive: true });
    assert.deepEqual(remaining, [], "补偿后目标前缀应为空");
  });

  it("A4/补偿自身失败: 补偿里再抛也不掩盖主错误（且不冒泡）", async () => {
    const project = await ctx.projects.create(`P-a4comp-${Date.now()}`);
    const scopeKey = `project:${project.id}`;
    const scope = { kind: "project" as const, projectId: project.id };

    // 只拦补偿要删的那批新文件的 entry 删除；段 B0 删的旧文件不受影响，
    // 于是「片失败 → 补偿 → 补偿抛」这条路径被单独隔离出来。
    await ctx.conn.execute(
      `CREATE TRIGGER t_block_compensate_delete
       BEFORE DELETE ON vfs_entry
       WHEN OLD.scope_key = '${scopeKey}' AND OLD.path LIKE '/f01%'
       BEGIN SELECT RAISE(ABORT, 'blocked'); END`
    );

    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((a) => String(a)).join(" "));
    };
    try {
      await assert.rejects(
        () =>
          createVfsZipIoService(conn, {
            testHook: { throwOnInsertLogical: "/f0200.md" },
          }).import(scope, buildVfsZip(filesMap(450)), { confirmed: true }),
        (e: unknown) =>
          e instanceof Error && e.message === "test import failure"
      );
    } finally {
      console.warn = originalWarn;
      await ctx.conn.execute(`DROP TRIGGER IF EXISTS t_block_compensate_delete`);
    }

    assert.ok(
      warns.some((w) => w.includes("import compensation failed")),
      "补偿失败必须被吞掉并记 warn"
    );
  });

  it("A6: 5000 文件 → 事务调用次数 == ceil(5000/200)+2 == 27，单事务语句数有界", async () => {
    const project = await ctx.projects.create(`P-a6-${Date.now()}`);
    const scope = { kind: "project" as const, projectId: project.id };
    const files = filesMap(5000);

    probe.reset();
    await createVfsZipIoService(conn).import(
      scope,
      buildVfsZip(files),
      { confirmed: true }
    );

    const expectedShards = Math.ceil(5000 / CHUNK);
    assert.equal(expectedShards, 25);
    assert.equal(
      probe.transactionCount,
      expectedShards + 2,
      "段 B0 ×1 + 文件片 ×25 + 段 R ×1"
    );

    // 单事务语句条数上界：≤ 200 × K（K = 单文件语句条数上界）。
    for (let i = 0; i < expectedShards; i++) {
      const n = probe.statementCountInTransaction(i + 1);
      assert.ok(
        n <= CHUNK * STATEMENTS_PER_FILE_UPPER_BOUND,
        `第 ${i + 1} 片事务内语句数 ${n} 越界`
      );
      assert.ok(n > 0, `第 ${i + 1} 片必须真的写了东西`);
    }

    const revisions = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.scope_key = ?`,
      [`project:${project.id}`]
    );
    assert.equal(Number(revisions[0]!.n), 5000);
  });
});