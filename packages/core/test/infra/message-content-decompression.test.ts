/**
 * 消息正文解压搬运（反向任务）用例：T-MP2（round-trip + 收尾不变量 +
 * 标记自愈）、T-MP2b（断点续跑）、T-MP3（坏行隔离）、T-MP-P1（用时护栏）、
 * T-MP-P2（搬完零重扫）、T-MP5（旧 pending 欠账清偿）。
 *
 * 幂等与可重入口径照 spec Part 2：谓词 `content_blob IS NOT NULL`，批 ≤100
 * 行短事务，完成置两段式 KKV 标记（`nm-message-decompress` /
 * `decompressDone`）。共享库上每个用例自管标记状态（开头清标记，含正向
 * 任务遗留的 `nm-message-content/startupMaintenancePending`）。
 *
 * **夹具口径**：压缩行**不经生产写路径**——`encodeMessageContent`
 * 已随 Step 3 删除、`batchInsert` 已写明文，已无生产 API 能造压缩行；用
 * `compressZlib` + 裸 `INSERT INTO chat_message` 直造（与 T-MP-P0
 * 基线构造同款口径）。
 *
 * **用例顺序纪律**：`runStartupMaintenanceOnce` 是模块级进程去重，本文件
 * 首条进入维护段的用例必须是 T-MP5 的「pending 置位库被消费」（它需要进程
 * 级标记初始未被消费才会真跑维护链路）；其后任何用例都不会再触发维护
 * （本任务自身不挂 VACUUM，见实现注释），不影响各自断言。
 *
 * @module test/infra/message-content-decompression
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  DEFAULT_DECOMPRESS_SYNC_BUDGET_MS,
  getMessageDecompressStatus,
  LEGACY_MAINTENANCE_PENDING_KKV_KEY,
  LEGACY_MESSAGE_CONTENT_KKV_MODULE,
  MESSAGE_DECOMPRESS_KKV_KEY,
  MESSAGE_DECOMPRESS_KKV_MODULE,
  runMessageContentDecompress,
} from "../../src/infra/db-maintenance/index.js";
import { compressZlib } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import type { Row } from "../../src/infra/tdbc/types.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { ChatMessage, MessageContent } from "../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../src/domain/chat/model/content-block.js";

novelMasterTestFixture();

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

/** 每条用例开头自管标记状态：清本任务完成标记 + 正向遗留 pending 标记。 */
async function clearMarkers(): Promise<void> {
  await conn().execute(
    "DELETE FROM kkv_entry WHERE (module = ? AND key = ?) OR (module = ? AND key = ?)",
    [
      MESSAGE_DECOMPRESS_KKV_MODULE,
      MESSAGE_DECOMPRESS_KKV_KEY,
      LEGACY_MESSAGE_CONTENT_KKV_MODULE,
      LEGACY_MAINTENANCE_PENDING_KKV_KEY,
    ]
  );
}

/** 剩余压缩行计数（谓词，与实现同条件）。 */
async function pendingCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_blob IS NOT NULL"
  );
  return Number(rows[0]?.n ?? 0);
}

async function doneMarkerCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
    [MESSAGE_DECOMPRESS_KKV_MODULE, MESSAGE_DECOMPRESS_KKV_KEY]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 正向任务遗留 pending 标记存在性计数。 */
async function legacyPendingMarkerCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
    [LEGACY_MESSAGE_CONTENT_KKV_MODULE, LEGACY_MAINTENANCE_PENDING_KKV_KEY]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 新建一个会话。 */
async function newSession(): Promise<string> {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
  return session.id;
}

/** 混合内容构造：长中文 / tool_use / tool_result / thinking 块交替。 */
function mixedContent(i: number): MessageContent {
  const blocks: ContentBlock[] = [
    {
      type: "text",
      text: `第 ${i} 条混合消息：${"长中文正文测试。".repeat(20 + (i % 7))}`,
    },
  ];
  if (i % 3 === 0) {
    blocks.push({
      type: "tool_use",
      id: `tu-${i}`,
      name: "write",
      input: { path: `/第${i}章.md`, content: "章节草稿".repeat(30) },
    });
  }
  if (i % 3 === 1) {
    blocks.push({
      type: "tool_result",
      toolUseId: `tu-${i}`,
      content: `工具返回结果 ${i}：${"output".repeat(50)}`,
    });
  }
  if (i % 5 === 0) {
    blocks.push({ type: "thinking", text: `思考过程 ${i}` });
  }
  return { blocks };
}

/** 8KB 量级中文正文（T-MP-P1 的单条体量，对齐重度长会话消息）。 */
function largeTextBody(i: number): string {
  return `第 ${i} 条长正文样本。${"云舟渡口灯火渐起，少年负剑西行。".repeat(120)}`;
}

/**
 * 裸 INSERT 造一条压缩形态行（不经生产写路径）。
 *
 * 形态与写侧逐字对齐：content_json 为空串、content_encoding='zlib'、
 * content_blob 为二进制 zlib 字节。
 */
async function insertCompressedRow(args: {
  sessionId: string;
  seq: number;
  content: MessageContent;
}): Promise<string> {
  const id = randomUUID();
  const blob = compressZlib(
    new TextEncoder().encode(JSON.stringify(args.content))
  );
  await conn().execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, content_encoding, content_blob,
       created_at_ms, hidden
     ) VALUES (?, ?, ?, 'user', '', 'zlib', ?, ?, 0)`,
    [id, args.sessionId, args.seq, blob, Date.now() + args.seq]
  );
  return id;
}

/** 裸 INSERT 造一条**坏行**（encoding=zlib 但字节不是合法 zlib 流）。 */
async function insertCorruptRow(args: {
  sessionId: string;
  seq: number;
}): Promise<{ id: string; blob: Uint8Array }> {
  const id = randomUUID();
  // 合法 zlib 头（0x78 0x9c）后跟垃圾数据：inflate 必抛，绝不会被误解成
  // 另一段明文（那才是「读出错内容」的事故）。
  const blob = new Uint8Array([0x78, 0x9c, 0xff, 0xfe, 0x00, 0x7f, 0x42, 0x99]);
  await conn().execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, content_encoding, content_blob,
       created_at_ms, hidden
     ) VALUES (?, ?, ?, 'user', '', 'zlib', ?, ?, 0)`,
    [id, args.sessionId, args.seq, blob, Date.now() + args.seq]
  );
  return { id, blob };
}

// ---------------------------------------------------------------------------
// SQL 探针（自带 conn.execute 口
// 覆写——UPDATE / VACUUM / wal_checkpoint 都走该口，只覆 query/transaction
// 会漏观测）。
// ---------------------------------------------------------------------------

/** 探针记录：语句 + 参数 + 结果行数（execute 为 -1）。 */
interface ProbeRecord {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
}

async function withSqlProbe<T>(
  fn: () => Promise<T>
): Promise<{ result: T; records: ProbeRecord[] }> {
  const c = conn();
  const records: ProbeRecord[] = [];
  const originalQuery = c.query;
  const originalExecute = c.execute;
  const originalTransaction = c.transaction;

  c.query = (async (sql: string, parameters?: readonly unknown[]) => {
    const rows = await originalQuery.call(c, sql, parameters);
    records.push({ sql, params: parameters ?? [], rowCount: rows.length });
    return rows;
  }) as TdbcConnection["query"];

  c.execute = (async (sql: string, parameters?: readonly unknown[]) => {
    records.push({ sql, params: parameters ?? [], rowCount: -1 });
    return await originalExecute.call(c, sql, parameters);
  }) as TdbcConnection["execute"];

  c.transaction = (<T>(inner: (tx: TdbcConnection) => Promise<T>) =>
    originalTransaction.call(c, async (tx) => {
      const originalTxExecute = tx.execute;
      tx.execute = ((sql: string, parameters?: readonly unknown[]) => {
        records.push({ sql, params: parameters ?? [], rowCount: -1 });
        return originalTxExecute.call(tx, sql, parameters);
      }) as TdbcConnection["execute"];
      try {
        return await inner(tx);
      } finally {
        tx.execute = originalTxExecute;
      }
    })) as TdbcConnection["transaction"];

  try {
    return { result: await fn(), records };
  } finally {
    c.query = originalQuery;
    c.execute = originalExecute;
    c.transaction = originalTransaction;
  }
}

// SQL 识别（探针与替身共用同一口径）。
const isVacuum = (sql: string): boolean => /^\s*VACUUM\b/i.test(sql);
const isChatMessageUpdate = (sql: string): boolean =>
  /^\s*UPDATE\s+chat_message\b/i.test(sql);
const isCountStar = (sql: string): boolean => /SELECT\s+COUNT\(\*\)/i.test(sql);
/** 实现的 keyset 批查询（含 rowid 游标参数的 SELECT）。 */
const isBatchSelect = (sql: string): boolean =>
  /SELECT\s+rowid,\s*id,\s*content_encoding,\s*content_blob\s+FROM\s+chat_message/i.test(
    sql
  );
/** 入口自愈探测（`SELECT 1 ... LIMIT 1`，与批查询同谓词但形态不同）。 */
const isSelfHealProbe = (sql: string): boolean =>
  /SELECT\s+1\s+AS\s+present\s+FROM\s+chat_message[\s\S]*LIMIT\s+1/i.test(sql);

// ---------------------------------------------------------------------------
// 连接替身：UPDATE 恒 changes=0（模拟驱动写回不生效）。
// ---------------------------------------------------------------------------

/**
 * 让 chat_message 的 UPDATE 恒（或按 id 定向）返回 `changes = 0` 的连接
 * 替身——模拟「驱动写回静默不生效」：UPDATE 不真正执行，行原样留在谓词里。
 *
 * @param stuckIds `"all"` 短路全部 chat_message UPDATE；否则只短路主键
 * 命中集合的行。UPDATE 绑参形态是 `[明文, id]`（压缩两列恒置 NULL，不绑参），
 * 故行主键取第 2 个参数。
 */
function wrapConnChatUpdateNoEffect(stuckIds: ReadonlySet<string> | "all"): {
  readonly wrapped: TdbcConnection;
  readonly shortCircuitedCount: () => number;
} {
  const real = conn();
  let shortCircuited = 0;
  const wrapTx = (realTx: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      if (isChatMessageUpdate(sql)) {
        const rowId = String(parameters?.[1] ?? "");
        if (stuckIds === "all" || stuckIds.has(rowId)) {
          shortCircuited += 1;
          return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
        }
      }
      return realTx.execute(sql, parameters);
    },
    query: <R extends Row>(sql: string, parameters?: readonly unknown[]) =>
      realTx.query<R>(sql, parameters),
    batch: (sql, parametersList) => realTx.batch(sql, parametersList),
    transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>) =>
      realTx.transaction<T>((nested) => fn(wrapTx(nested))),
    close: () => realTx.close(),
  });
  return { wrapped: wrapTx(real), shortCircuitedCount: () => shortCircuited };
}

// ---------------------------------------------------------------------------
// T-MP5：旧 pending 欠账清偿（**必须保持为本文件首条进入维护段的用例**）。
// ---------------------------------------------------------------------------

describe("旧 pending 欠账清偿（T-MP5）", () => {
  /**
   * **必须声明为本文件第一条进入维护段的用例**：`runStartupMaintenanceOnce`
   * 是模块级进程去重，进程级标记初始未消费时才会真跑维护链路，pending 才
   * 会被清掉（返回非 null 才清，见实现注释）。
   */
  it("正向遗留的 startupMaintenancePending 被入口消费并清除（真跑一次去重维护）", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    // 造点活干：一条压缩行（本用例不关心搬运结果，只关心欠账清偿）。
    await insertCompressedRow({ sessionId, seq: 1, content: mixedContent(1) });
    // 置正向遗留的 pending 标记（正向任务收尾维护失败时的兜底标记形态）。
    await conn().execute(
      "INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, '1')",
      [LEGACY_MESSAGE_CONTENT_KKV_MODULE, LEGACY_MAINTENANCE_PENDING_KKV_KEY]
    );
    assert.equal(await legacyPendingMarkerCount(), 1, "前置：pending 标记已置位");

    let beforeCount = 0;
    let afterCount = 0;
    const { result, records } = await withSqlProbe(() =>
      runMessageContentDecompress(conn(), {
        beforeMaintenance: () => {
          beforeCount += 1;
        },
        afterMaintenance: () => {
          afterCount += 1;
        },
      })
    );

    assert.equal(result.done, true, "欠账清偿不影响搬运完成态");
    assert.equal(beforeCount, 1, "进入维护段恰一次（补跑维护）");
    assert.equal(afterCount, 1, "finally 语义复位恰一次");
    assert.equal(
      records.filter((r) => isVacuum(r.sql)).length,
      1,
      "真跑一次全库 VACUUM（去重版 runStartupMaintenanceOnce）"
    );
    assert.equal(
      await legacyPendingMarkerCount(),
      0,
      "维护真跑且未抛错（返回非 null）→ pending 欠账标记已清"
    );
  });

  it("未置位的库零调用：不进维护段、不下发 VACUUM", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    await insertCompressedRow({ sessionId, seq: 1, content: mixedContent(2) });

    let beforeCount = 0;
    let afterCount = 0;
    const { result, records } = await withSqlProbe(() =>
      runMessageContentDecompress(conn(), {
        beforeMaintenance: () => {
          beforeCount += 1;
        },
        afterMaintenance: () => {
          afterCount += 1;
        },
      })
    );

    assert.equal(result.done, true);
    assert.equal(beforeCount, 0, "无欠账不进维护段");
    assert.equal(afterCount, 0, "无欠账不复位");
    assert.deepEqual(
      records.filter((r) => isVacuum(r.sql)),
      [],
      "无欠账不得下发 VACUUM（本任务自身不挂收尾维护链路）"
    );
    assert.equal(await legacyPendingMarkerCount(), 0, "无欠账可清");
  });
});

// ---------------------------------------------------------------------------
// T-MP2：round-trip + 收尾不变量 + 标记自愈。
// ---------------------------------------------------------------------------

describe("反向搬运 round-trip 与完成标记（T-MP2）", () => {
  it("T-MP2：搬完逐条与构造原文全等、谓词归零、KKV 标记置位", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    const originals: MessageContent[] = [];
    const ROWS = 30;
    for (let i = 1; i <= ROWS; i++) {
      const content = mixedContent(i);
      await insertCompressedRow({ sessionId, seq: i, content });
      originals.push(content);
    }
    assert.equal(await pendingCount(), ROWS, "前置：全部是压缩行");

    const result = await runMessageContentDecompress(conn());
    assert.equal(result.done, true);
    assert.equal(result.decompressedCount, ROWS, "夹具行数，值必须精确");
    assert.equal(result.failedCount, 0);
    assert.equal(result.stalled, false);
    assert.equal(await pendingCount(), 0, "谓词（content_blob IS NOT NULL）归零");
    assert.equal(await doneMarkerCount(), 1, "KKV 完成标记应已置（两段式）");

    // 逐条与构造原文全等（含长中文 / tool 块这类混合 blocks）。
    const repo = new SqliteMessageRepository(conn());
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, ROWS, "一条不少");
    for (const message of list) {
      assert.equal(
        JSON.stringify(message.content),
        JSON.stringify(originals[message.seq - 1]!),
        `seq=${message.seq} 逐字节一致`
      );
    }

    // 存储形态：压缩两列已清、明文列非空（正形态与写侧逐字对齐）。
    const shapes = await conn().query<{
      n: number;
      encoding_null: number;
      blob_null: number;
    }>(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN content_encoding IS NULL THEN 1 ELSE 0 END) AS encoding_null,
              SUM(CASE WHEN content_blob IS NULL THEN 1 ELSE 0 END) AS blob_null
       FROM chat_message WHERE session_id = ?`,
      [sessionId]
    );
    assert.equal(Number(shapes[0]!.n), ROWS);
    assert.equal(Number(shapes[0]!.encoding_null), ROWS, "encoding 全置 NULL");
    assert.equal(Number(shapes[0]!.blob_null), ROWS, "blob 全置 NULL");

    // 状态采样：完成态零 COUNT 成本（探针断言，非只看返回值）。
    const statusProbe = await withSqlProbe(() => getMessageDecompressStatus(conn()));
    assert.equal(statusProbe.result.done, true);
    assert.equal(statusProbe.result.pendingCount, 0);
    assert.deepEqual(
      statusProbe.records.filter((r) => isCountStar(r.sql)),
      [],
      "完成态采样零 COUNT 成本（只读 KKV 标记）"
    );
  });

  it("T-MP2 收尾不变量：驱动写回不生效 → 谓词残留 > 已知坏行 → stalled、不置标记", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    const stuckId = await insertCompressedRow({
      sessionId,
      seq: 1,
      content: mixedContent(7),
    });

    // 单行即可触发：批 1 打转（changes=0，护栏未到 3 批）→ 游标推过 → 批 2
    // 空批收尾 → 谓词仍剩 1 行 > 已知坏行 0 行。正向任务同款不变量：
    // **没有这道校验任务会谎报完成、把残留行永久锁死在压缩态**。
    const { wrapped, shortCircuitedCount } = wrapConnChatUpdateNoEffect(
      new Set([stuckId])
    );
    const result = await runMessageContentDecompress(wrapped);
    assert.equal(result.done, false, "残留未清不得报完成");
    assert.equal(result.stalled, true, "收尾不变量拦停并透传 stalled");
    assert.equal(result.decompressedCount, 0, "没有一行真落库");
    assert.equal(shortCircuitedCount(), 1, "该行恰被短路一次");
    assert.equal(await doneMarkerCount(), 0, "残留未清不得置完成标记");
    assert.equal(await pendingCount(), 1, "残留行保持压缩形态");

    // 顺带钉住批查询形态：keyset 游标（`rowid > ?`）存在且单调推进。
    const probe = await withSqlProbe(() => runMessageContentDecompress(conn()));
    const cursors = probe.records
      .filter((r) => isBatchSelect(r.sql) && r.rowCount > 0)
      .map((r) => Number(r.params[0]));
    assert.equal(cursors[0], 0, "首批游标从 0 起扫（rowid 恒正）");
  });

  it("T-MP2 标记自愈：标记已置位但库中仍有压缩行（快照回灌）→ 清标记续搬", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    const content = mixedContent(11);
    const id = await insertCompressedRow({ sessionId, seq: 1, content });

    // 先手工置上完成标记（模拟「标记随整库快照 travels」的回灌态）：标记说
    // 已解完，库里却还是压缩形态。
    await conn().execute(
      "INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?)",
      [MESSAGE_DECOMPRESS_KKV_MODULE, MESSAGE_DECOMPRESS_KKV_KEY, JSON.stringify({ at: "2026-01-01T00:00:00.000Z", failedCount: 0 })]
    );
    assert.equal(await doneMarkerCount(), 1, "前置：完成标记已置位");

    const result = await runMessageContentDecompress(conn());
    assert.equal(result.done, true);
    assert.equal(result.decompressedCount, 1, "自愈后真搬（不是被标记短路）");
    assert.equal(await pendingCount(), 0, "压缩行已解完");
    assert.equal(await doneMarkerCount(), 1, "搬完重新置标记（自愈闭环）");

    // 读回全等（证明搬的是正确明文，不是「清标记后随便搬」）。
    const repo = new SqliteMessageRepository(conn());
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.equal(JSON.stringify(list[0]!.content), JSON.stringify(content));
    assert.equal(list[0]!.id, id);

    // 二次调用：探测不命中 → 短路（这正是零重扫的另一半，见 T-MP-P2）。
    const second = await withSqlProbe(() => runMessageContentDecompress(conn()));
    assert.equal(second.result.done, true);
    assert.equal(second.result.decompressedCount, 0);
  });
});

// ---------------------------------------------------------------------------
// T-MP2b：断点续跑。
// ---------------------------------------------------------------------------

describe("迁移中断续跑（T-MP2b）", () => {
  it("syncBudgetMs:0 截断首轮造中间态，续跑从谓词剩余集继续、已搬行不重复 UPDATE、终态全等", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    const originals: MessageContent[] = [];
    const ROWS = 120;
    for (let i = 1; i <= ROWS; i++) {
      const content = mixedContent(i);
      await insertCompressedRow({ sessionId, seq: i, content });
      originals.push(content);
    }

    // 第一轮：预算 0ms → 恰搬完第一批即中断（断电/杀进程的等效形态）。
    const interrupted = await runMessageContentDecompress(conn(), {
      syncBudgetMs: 0,
    });
    assert.equal(interrupted.done, false, "预算耗尽返回未完成");
    assert.equal(interrupted.decompressedCount, 100, "第一批 100 行已搬");
    assert.equal(await pendingCount(), 20, "中间态：剩余 20 条");
    assert.equal(
      await doneMarkerCount(),
      0,
      "中断不得置完成标记（否则残留行被永久跳过）"
    );

    // 第二轮（模拟重启）：谓词重扫续跑，探针计 UPDATE 次数。
    const resumed = await withSqlProbe(() => runMessageContentDecompress(conn()));
    assert.equal(resumed.result.done, true);
    assert.equal(
      resumed.result.decompressedCount,
      20,
      "只搬剩余 20 条（已搬行天然排除在谓词外）"
    );
    assert.equal(
      resumed.records.filter((r) => isChatMessageUpdate(r.sql)).length,
      20,
      "已搬 100 行不得重复 UPDATE（探针计数）"
    );
    assert.equal(await pendingCount(), 0);
    assert.equal(await doneMarkerCount(), 1, "收敛后才置标记");

    // 终态全等：120 条一条不少、逐条一致。
    const repo = new SqliteMessageRepository(conn());
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, ROWS);
    for (const message of list) {
      assert.equal(
        JSON.stringify(message.content),
        JSON.stringify(originals[message.seq - 1]!),
        `seq=${message.seq} 续跑后逐字节一致`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// T-MP-P2：搬完零重扫。
// ---------------------------------------------------------------------------

describe("搬完零重扫（T-MP-P2）", () => {
  it("二次调用：零 COUNT 谓词、零库写、自愈探测恰好一次", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    const ROWS = 5;
    for (let i = 1; i <= ROWS; i++) {
      await insertCompressedRow({ sessionId, seq: i, content: mixedContent(i) });
    }
    const first = await runMessageContentDecompress(conn());
    assert.equal(first.done, true);
    assert.equal(first.decompressedCount, ROWS);

    // 二次调用（路径覆盖级断言：把短路删掉也照样绿的字段断言不算数）。
    const second = await withSqlProbe(() => runMessageContentDecompress(conn()));
    assert.equal(second.result.done, true);
    assert.equal(second.result.decompressedCount, 0, "零搬运");
    assert.deepEqual(
      second.records.filter((r) => isChatMessageUpdate(r.sql)),
      [],
      "不得下发 UPDATE chat_message（零库写）"
    );
    assert.deepEqual(
      second.records.filter((r) => isCountStar(r.sql)),
      [],
      "零 COUNT 谓词（不扫全表）"
    );
    assert.deepEqual(
      second.records.filter((r) => isBatchSelect(r.sql)),
      [],
      "零批查询（不碰搬运源列）"
    );
    assert.equal(
      second.records.filter((r) => isSelfHealProbe(r.sql)).length,
      1,
      "自愈探测恰好一次（入口固定成本，索引级 LIMIT 1）"
    );
  });
});

// ---------------------------------------------------------------------------
// T-MP-P1：用时护栏。
// ---------------------------------------------------------------------------

describe("反向搬运用时护栏（T-MP-P1）", () => {
  /**
   * 绝对预算上限：任一侧超过它就失败，不参与倍数比较（兜「基线侧被环境噪声
   * 拖到极慢导致倍数假绿」）。100 条 × 8KB 的空载实测在百毫秒量级，
   * 20000ms 是两三个数量级的余量。
   */
  const ABSOLUTE_BUDGET_MS = 20_000;

  /**
   * 允许倍数（数量级回归线，照 RULE「性能护栏取数量级回归线」：卡数量级，
   * 不卡小数点）。解压搬运 = inflate + 写回明文 + 单行短事务，比「同构明文
   * 全量读」贵一个数量级是预期内的；25 是防「搬一趟比读一趟慢两个数量级」
   * 那类事故的回归线。
   */
  const MAX_RATIO = 25;

  /** 倍数比较的毫秒下限（吸收 `Date.now()` 精度地板）。 */
  const RATIO_FLOOR_MS = 10;

  it("100 行压缩→明文解压写回耗时不超同构明文全量读基线的 25 倍", async () => {
    await clearMarkers();
    const ctx = getNovelMasterTestContext();
    const ROWS = 100;

    // 压缩形态库（裸 INSERT，100 条 8KB 量级正文）。
    const compressedProject = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const compressedSession = await ctx.sessions.create(
      compressedProject.id,
      `S-${testIsolationSuffix()}`
    );
    for (let i = 1; i <= ROWS; i++) {
      await insertCompressedRow({
        sessionId: compressedSession.id,
        seq: i,
        content: { blocks: [{ type: "text", text: largeTextBody(i) }] },
      });
    }
    assert.equal(await pendingCount(), ROWS, "前置：100 条压缩行待搬");

    const t0 = Date.now();
    const result = await runMessageContentDecompress(ctx.conn);
    const decompressMs = Date.now() - t0;
    assert.equal(result.done, true, "搬运应完成（否则护栏在测半截活）");
    assert.equal(result.decompressedCount, ROWS, "100 行全部搬走");
    assert.equal(await pendingCount(), 0);

    // 同构明文库（全量读基线）：同样 100 条同体量明文，走生产写路径。
    const plainProject = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const plainSession = await ctx.sessions.create(
      plainProject.id,
      `S-${testIsolationSuffix()}`
    );
    const messages: ChatMessage[] = [];
    for (let i = 1; i <= ROWS; i++) {
      messages.push({
        id: randomUUID(),
        sessionId: plainSession.id,
        seq: i,
        role: "user",
        content: { blocks: [{ type: "text", text: largeTextBody(i) }] },
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
      });
    }
    const repo = new SqliteMessageRepository(ctx.conn);
    await repo.batchInsert(messages);
    // 预热一次（JIT / SQLite 页缓存），再计时取稳定值。
    await repo.listBySessionTail(plainSession.id, ROWS);
    const t1 = Date.now();
    const tail = await repo.listBySessionTail(plainSession.id, ROWS);
    const baselineMs = Date.now() - t1;
    assert.equal(tail.length, ROWS, "基线读回 100 条");

    // 内容深比对：防「护栏量的是一个空/错结果的库」（解压错位必红）。
    assert.equal(
      JSON.stringify(tail.map((m) => m.content)),
      JSON.stringify(messages.map((m) => m.content))
    );

    // 绝对预算先行：任一侧被打扰到极慢时倍数不可比，先钉死各自量级。
    assert.ok(
      decompressMs <= ABSOLUTE_BUDGET_MS,
      `解压搬运耗时 ${decompressMs}ms 超绝对预算 ${ABSOLUTE_BUDGET_MS}ms（环境噪声，本护栏失效）`
    );
    assert.ok(
      baselineMs <= ABSOLUTE_BUDGET_MS,
      `明文全量读基线 ${baselineMs}ms 超绝对预算 ${ABSOLUTE_BUDGET_MS}ms`
    );

    const budgetMs = Math.max(baselineMs * MAX_RATIO, RATIO_FLOOR_MS);
    assert.ok(
      decompressMs <= budgetMs,
      `解压搬运耗时 ${decompressMs}ms 超过明文全量读基线 ${baselineMs}ms 的 ${MAX_RATIO} 倍`
    );

    // 默认预算常量钉死 60s（升级首启有界同步收尾的 spec 拍板值）。
    assert.equal(DEFAULT_DECOMPRESS_SYNC_BUDGET_MS, 60_000);
  });
});

// ---------------------------------------------------------------------------
// T-MP3：坏行隔离。
// ---------------------------------------------------------------------------

describe("坏行隔离（T-MP3）", () => {
  it("decode 失败行保持压缩形态、failedCount 透传、完成标记照置（其余行搬完）", async () => {
    await clearMarkers();
    const sessionId = await newSession();
    // 好行 seq 2..5，坏行占 seq 1：`listBySessionTail(sessionId, 4)` 取的
    // 是 seq 倒序的前 4 条（5,4,3,2），恰好全是好行——好行的读回断言不被
    // 坏行污染（读路径对坏行是 fail-fast，见下方断言）。
    const bad = await insertCorruptRow({ sessionId, seq: 1 });
    const ROWS = 4;
    const originals = new Map<number, MessageContent>();
    for (let i = 2; i <= ROWS + 1; i++) {
      const content = mixedContent(i);
      await insertCompressedRow({ sessionId, seq: i, content });
      originals.set(i, content);
    }

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    let result: Awaited<ReturnType<typeof runMessageContentDecompress>>;
    try {
      result = await runMessageContentDecompress(conn());
    } finally {
      console.warn = originalWarn;
    }

    // 坏行不阻断收敛：其余 4 行全搬完、标记照置。
    assert.equal(result.done, true, "坏行不阻断完成标记的置位");
    assert.equal(result.decompressedCount, ROWS, "其余 4 行全部搬完");
    assert.equal(result.failedCount, 1, "坏行计入 failedCount");
    assert.equal(result.stalled, false);
    assert.ok(
      warnings.some((line) => line.includes("解码失败")),
      "坏行应逐行 warn 隔离"
    );
    assert.ok(
      warnings.some((line) => line.includes(bad.id)),
      "告警应带消息 id 定位"
    );

    // 完成标记已置，值是 JSON 且 failedCount 快照为 1。
    const markerRows = await conn().query<{ value: string }>(
      "SELECT value FROM kkv_entry WHERE module = ? AND key = ?",
      [MESSAGE_DECOMPRESS_KKV_MODULE, MESSAGE_DECOMPRESS_KKV_KEY]
    );
    const parsed = JSON.parse(markerRows[0]!.value) as {
      at: string;
      failedCount: number;
    };
    assert.equal(parsed.failedCount, 1, "标记 JSON 里的 failedCount 快照");
    assert.equal(typeof parsed.at, "string");

    // 坏行**原样保留压缩形态**（未被覆写成错明文）。
    const badRow = await conn().query<{
      content_json: string;
      content_encoding: string | null;
      typeOf: string | null;
    }>(
      `SELECT content_json, content_encoding, TYPEOF(content_blob) AS typeOf
       FROM chat_message WHERE id = ?`,
      [bad.id]
    );
    assert.equal(badRow[0]!.content_encoding, "zlib", "坏行 encoding 保留");
    assert.equal(badRow[0]!.content_json, "", "坏行明文列未被写入（无错明文）");
    assert.equal(badRow[0]!.typeOf, "blob", "坏行 blob 原样保留");

    // 读路径语义：好行读回全等（明文形态已就位）。
    const repo = new SqliteMessageRepository(conn());
    const goodTail = await repo.listBySessionTail(sessionId, ROWS);
    assert.equal(goodTail.length, ROWS, "好行一条不少");
    for (const message of goodTail) {
      assert.equal(
        JSON.stringify(message.content),
        JSON.stringify(originals.get(message.seq)),
        `seq=${message.seq} 搬完后读回全等`
      );
    }

    // 坏行的读语义：任务与读路径共用同一个纯解码器，故这里不是「读得出旧
    // 压缩内容」而是 fail-fast 抛错——**绝不返回错内容**（行从未被改写，
    // 压缩字节完好；一旦 blob 可解压，readRowContent 立刻读回原正文）。
    // 这是「坏行隔离而非 fail-fast 全局」的价值所在：只有这一行不可读，
    // 其余 4 行照常可读、迁移照常收敛。
    await assert.rejects(
      () => repo.listBySession(sessionId),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes(bad.id);
      },
      "坏行读路径 fail-fast（不静默丢行、不返回错内容）"
    );

    // 二次调用：坏行仍在谓词里，但 failedKeys 覆盖它 → 仍判完成，不空转。
    const second = await runMessageContentDecompress(conn());
    assert.equal(second.done, true, "坏行存在不阻断完成态");
    assert.equal(second.decompressedCount, 0, "第二次零搬运（好行已搬）");
    assert.equal(second.failedCount, 1, "坏行再次计入（口径稳定）");
  });
});
