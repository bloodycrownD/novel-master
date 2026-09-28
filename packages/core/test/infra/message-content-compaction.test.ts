/**
 * 消息正文压缩搬运任务用例（T-C7 ~ T-C9 + 守卫/状态采样 + ic-01/05/07/
 * 09/25 验收 + OQ-I7 不变量守护）。
 *
 * 幂等与可重入口径见 spec「总体方案 3」：谓词 content_json != ''，
 * 批 ≤100 行短事务，完成置 KKV 标记（两段式 nm-message-content/
 * compactionDone）。共享库上每个用例自管标记状态（开头清标记，含
 * startupMaintenancePending 兜底标记），与 file-cache-store.test.ts 的
 * 直查断言风格一致。
 *
 * **用例顺序纪律（ic-01 r4 补）**：`runStartupMaintenanceOnce` 是模块级
 * 进程去重，本文件首条进入维护段的用例必须是「ic-01② 收尾维护 VACUUM
 * 抛错」——它依赖进程级标记未被消费才会真跑维护链路（撞注入的抛错）；
 * 其后所有用例的收尾维护都被去重短路（返回 null），不影响各自断言。
 * 同进程双任务「VACUUM 恰 1 次」用例（ic-01①）另立独立文件承载（独立
 * 进程 + 独立内存库，标记各自干净）：message-content-compaction-
 * maintenance.test.ts。坏行隔离（编码抛错注入）因 mock.module 范式也
 * 独立成文件：message-content-compaction-bad-row.test.ts。
 *
 * @module test/infra/message-content-compaction
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  runMessageContentCompaction,
  getMessageCompactionStatus,
  MESSAGE_COMPACTION_KKV_KEY,
  MESSAGE_COMPACTION_KKV_MODULE,
} from "../../src/infra/db-maintenance/index.js";
import { MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY } from "../../src/infra/db-maintenance/impl/message-content-compaction.js";
import type { MessageCompactionRunResult } from "../../src/infra/db-maintenance/index.js";
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

/** 每个用例开头自管标记状态：清 KKV 完成标记 + pending 兜底标记。 */
async function clearDoneMarker(): Promise<void> {
  await conn().execute(
    "DELETE FROM kkv_entry WHERE module = ? AND key IN (?, ?)",
    [
      MESSAGE_COMPACTION_KKV_MODULE,
      MESSAGE_COMPACTION_KKV_KEY,
      MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY,
    ]
  );
}

async function pendingCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_message WHERE content_json != ''"
  );
  return Number(rows[0]?.n ?? 0);
}

async function doneMarkerCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
    [MESSAGE_COMPACTION_KKV_MODULE, MESSAGE_COMPACTION_KKV_KEY]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 清全表明文行：共享库上前序用例可能残留未搬走的明文行（如
 * shouldPause 暂停、护栏拦停），游标累计 / 计数类用例必须从干净谓词起步。 */
async function clearPlaintextRows(): Promise<void> {
  await conn().execute("DELETE FROM chat_message WHERE content_json != ''");
}

/** pending 兜底标记（startupMaintenancePending）存在性计数。 */
async function pendingMarkerCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
    [
      MESSAGE_COMPACTION_KKV_MODULE,
      MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY,
    ]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 手工 INSERT 一条 legacy 明文行（模拟存量库 / e2e fixture）。 */
async function insertPlaintextRow(
  sessionId: string,
  seq: number,
  content: MessageContent,
  createdAtMs: number
): Promise<string> {
  const id = randomUUID();
  await conn().execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, created_at_ms, hidden
     ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
    [id, sessionId, seq, JSON.stringify(content), createdAtMs]
  );
  return id;
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

// ---------------------------------------------------------------------------
// SQL 探针（照 blob-binary-normalization.test.ts 的 withSqlProbe 抄，但
// **自带 conn.execute 口覆写**——VACUUM 与 wal_checkpoint 都走该口
// （db-maintenance.service.ts 的维护链路），只覆 query/transaction 会
// 静默漏观测维护语句）。
// ---------------------------------------------------------------------------

/** 探针记录：语句 + 参数 + 结果行数（execute 为 -1）。 */
interface ProbeRecord {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
}

/**
 * 包一层 SQL 探针：记录本轮实际下发给连接的语句（含事务内 `tx.execute`
 * 与维护链路的 `conn.execute`），query 语句顺带记录结果行数。
 *
 * @remarks 用完在 `finally` 里还原（共享连接不能带伤往下传给后续用例）。
 */
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

// SQL 识别（探针与替身共用同一口径）。 */
const isVacuum = (sql: string): boolean => /^\s*VACUUM\b/i.test(sql);
const isChatMessageUpdate = (sql: string): boolean =>
  /^\s*UPDATE\s+chat_message\b/i.test(sql);
const isCountStar = (sql: string): boolean => /SELECT\s+COUNT\(\*\)/i.test(sql);
/** 实现的 keyset 批查询（含 rowid 游标参数的 SELECT）。 */
const isBatchSelect = (sql: string): boolean =>
  /SELECT\s+rowid,\s*id,\s*content_json\s+FROM\s+chat_message/i.test(sql);

// ---------------------------------------------------------------------------
// 连接替身：UPDATE 恒 changes=0（打转）/ 第 N 次 UPDATE 抛错（批内中断）。
// ---------------------------------------------------------------------------

/**
 * 让 chat_message 的 UPDATE 恒（或按 id 定向）返回 `changes = 0` 的连接
 * 替身——模拟「写回不生效」：UPDATE 不真正执行（直接短路返回），行原样
 * 留在谓词里。
 *
 * @param stuckIds `"all"` 短路全部 chat_message UPDATE；否则只短路主键
 * （UPDATE 第 3 个参数）命中集合的行，其余照常落库。
 */
function wrapConnChatUpdateNoEffect(
  stuckIds: ReadonlySet<string> | "all"
): {
  readonly wrapped: TdbcConnection;
  /** 被短路的 UPDATE 次数。 */
  readonly shortCircuitedCount: () => number;
} {
  const real = conn();
  let shortCircuited = 0;
  const wrapTx = (realTx: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      if (isChatMessageUpdate(sql)) {
        const rowId = String(parameters?.[2] ?? "");
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

/**
 * 第 `failAt` 次 chat_message UPDATE 抛错的连接替身——模拟批内第 k 行
 * 的单行短事务提交失败（中间态：前 k-1 行已提交、第 k 行起未处理）。
 */
function wrapConnFailChatUpdateAtRow(failAt: number): TdbcConnection {
  const real = conn();
  let chatUpdates = 0;
  const wrapTx = (realTx: TdbcConnection): TdbcConnection => ({
    execute: async (sql, parameters) => {
      if (isChatMessageUpdate(sql)) {
        chatUpdates += 1;
        if (chatUpdates === failAt) {
          throw new Error(`模拟批内中断：第 ${failAt} 次 chat_message UPDATE 抛错`);
        }
      }
      return await realTx.execute(sql, parameters);
    },
    query: <R extends Row>(sql: string, parameters?: readonly unknown[]) =>
      realTx.query<R>(sql, parameters),
    batch: (sql, parametersList) => realTx.batch(sql, parametersList),
    transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>) =>
      realTx.transaction<T>((nested) => fn(wrapTx(nested))),
    close: () => realTx.close(),
  });
  return wrapTx(real);
}

// ---------------------------------------------------------------------------
// ic-01②：收尾维护链路失败兜底（**必须保持为本文件首条进入维护段的用例**）。
// ---------------------------------------------------------------------------

describe("收尾维护链路（ic-01）", () => {
  /**
   * **必须声明为本文件第一条进入维护段的用例**：`runStartupMaintenanceOnce`
   * 是模块级进程去重，本进程内首个调用者才会真跑维护链路。若前面已有
   * 用例跑过维护并置了去重标记，这条用例就短路成「什么都没跑」，注入的
   * VACUUM 抛错永远不会被触发（对齐 A1 线 NF-1 纪律）。
   */
  it("ic-01②：收尾维护 VACUUM 抛错——不 reject、pending 已写、同进程不白付第二次维护", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    await insertPlaintextRow(sessionId, 1, textBlocks("维护失败验证明文行"), Date.now());

    // VACUUM 直接抛（模拟磁盘满 / 库被锁），其余语句照常走真实连接。
    const c = conn();
    const wrapped: TdbcConnection = {
      execute: async (sql, parameters) => {
        if (isVacuum(sql)) {
          throw new Error("模拟磁盘满：VACUUM 失败");
        }
        return await c.execute(sql, parameters);
      },
      query: <R extends Row>(sql, parameters) => c.query<R>(sql, parameters),
      batch: (sql, parametersList) => c.batch(sql, parametersList),
      transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>) =>
        c.transaction<T>(fn),
      close: () => c.close(),
    };

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    let result: MessageCompactionRunResult;
    try {
      // 关键：不 reject——维护失败只 warn，搬运结果照常返回。
      result = await runMessageContentCompaction(wrapped);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(result.done, true, "维护失败不影响搬运完成态");
    assert.equal(result.compactedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(result.stalled, false);
    assert.ok(
      warnings.some((line) => line.includes("收尾维护链路")),
      "维护失败应只 warn 告警"
    );
    assert.equal(
      await pendingMarkerCount(),
      1,
      "维护失败应写 startupMaintenancePending 兜底标记"
    );
    assert.equal(
      await doneMarkerCount(),
      1,
      "完成标记照置（方案 b 维持「先置标记再跑维护」现状，靠 pending 补兜底）"
    );

    // 同进程第二次调用：入口读到 pending → 补跑被进程级去重短路（首次
    // 维护执行前置位、失败不回滚）→ 不再真跑 VACUUM（不白付第二次维护），
    // 标记保留待下次冷启动。
    const second = await withSqlProbe(() => runMessageContentCompaction(c));
    assert.equal(second.result.done, true, "标记短路照常返回完成");
    assert.equal(second.result.compactedCount, 0);
    assert.equal(
      second.records.filter((r) => isVacuum(r.sql)).length,
      0,
      "同进程第二次不得再真跑 VACUUM（进程级去重兜住）"
    );
    assert.equal(
      await pendingMarkerCount(),
      1,
      "去重短路返回 null 时保留 pending 标记待下次冷启动"
    );
  });
});

describe("消息正文压缩搬运任务（T-C7 ~ T-C9）", () => {
  it("T-C7：幂等——第二遍标记短路路径不触库写与计数", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    await insertPlaintextRow(sessionId, 1, textBlocks("幂等验证明文行"), Date.now());

    // 未完成态采样：done=false、pendingCount ≥ 1；探针**能观测到 COUNT**
    // （对照用例——证明探针对 COUNT 有牙，完成态的「零 COUNT」断言才可信）。
    const beforeProbe = await withSqlProbe(() =>
      getMessageCompactionStatus(conn())
    );
    assert.equal(beforeProbe.result.done, false);
    assert.ok(beforeProbe.result.pendingCount >= 1);
    assert.ok(
      beforeProbe.records.some((r) => isCountStar(r.sql)),
      "未完成态采样应下发 COUNT（对照：证明探针有牙）"
    );

    const first = await runMessageContentCompaction(conn());
    assert.equal(first.done, true);
    assert.equal(first.compactedCount, 1, "夹具 1 行，值必须精确");
    assert.equal(await pendingCount(), 0, "谓词应清空");
    assert.equal(await doneMarkerCount(), 1, "KKV 完成标记应已置（两段式）");

    // 第二遍：标记短路。路径覆盖级断言——不得下发 UPDATE chat_message、
    // 不得下发 COUNT（把短路删掉也照样绿的字段断言不算数，必须钉路径）。
    const second = await withSqlProbe(() => runMessageContentCompaction(conn()));
    assert.equal(second.result.done, true);
    assert.equal(second.result.compactedCount, 0);
    assert.deepEqual(
      second.records.filter((r) => isChatMessageUpdate(r.sql)),
      [],
      "标记短路路径不得触库写（不下发 UPDATE chat_message）"
    );
    assert.deepEqual(
      second.records.filter((r) => isCountStar(r.sql)),
      [],
      "标记短路路径不得触计数（不下发 COUNT）"
    );

    // 完成态采样：done=true 零 COUNT 成本（探针断言，非只看返回值）。
    const afterProbe = await withSqlProbe(() =>
      getMessageCompactionStatus(conn())
    );
    assert.equal(afterProbe.result.done, true);
    assert.equal(afterProbe.result.pendingCount, 0);
    assert.deepEqual(
      afterProbe.records.filter((r) => isCountStar(r.sql)),
      [],
      "完成态采样零 COUNT 成本（只读 KKV 标记）"
    );

    // 搬运后消息仍可读且等价。
    const repo = new SqliteMessageRepository(conn());
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.content, textBlocks("幂等验证明文行"));
  });

  it("T-C7b：清标记再跑 = 零搬运——谓词幂等的牙齿（与标记短路是两条路径）", async () => {
    // 上一条用例（T-C7）只覆盖「标记短路」这条快路径；本用例删掉完成
    // 标记、强迫真走谓词路径——已压缩行不得重新命中搬运，这才是谓词
    // 幂等本身的牙齿（把谓词写错成「已压缩行重新命中」时本用例必红）。
    await clearDoneMarker();
    const sessionId = await newSession();
    await insertPlaintextRow(sessionId, 1, textBlocks("谓词幂等验证明文行"), Date.now());

    const first = await runMessageContentCompaction(conn());
    assert.equal(first.done, true);
    assert.equal(first.compactedCount, 1);

    // 删完成标记，第二遍必须靠谓词排除已压缩行（而非标记短路）。
    await conn().execute(
      "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
      [MESSAGE_COMPACTION_KKV_MODULE, MESSAGE_COMPACTION_KKV_KEY]
    );
    const second = await withSqlProbe(() => runMessageContentCompaction(conn()));
    assert.equal(second.result.done, true, "谓词空等价完成");
    assert.equal(second.result.compactedCount, 0, "零搬运");
    assert.deepEqual(
      second.records.filter((r) => isChatMessageUpdate(r.sql)),
      [],
      "谓词幂等：已压缩行不得重新命中搬运（零 UPDATE）"
    );
    assert.equal(await doneMarkerCount(), 1, "谓词空时标记应重新置上");
    assert.equal(await pendingCount(), 0);
  });

  it("T-C8：可重入——批间中断（模拟杀进程）后重启续跑收敛", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    // 120 条明文行：第一轮（预算 0ms）搬完第一批 100 行即中断，
    // 剩余 20 条由第二次调用收敛。
    for (let i = 1; i <= 120; i++) {
      await insertPlaintextRow(sessionId, i, mixedContent(i), Date.now() + i);
    }

    const interrupted = await runMessageContentCompaction(conn(), {
      syncBudgetMs: 0,
    });
    assert.equal(interrupted.done, false, "预算耗尽应返回未完成");
    assert.equal(interrupted.compactedCount, 100, "第一批 100 行已搬运");
    const remaining = await pendingCount();
    assert.equal(remaining, 20, "中断时剩余 20 条");
    assert.equal(await doneMarkerCount(), 0, "中断时完成标记未置");

    // 模拟重启：重新调用（默认预算），谓词重扫续跑收敛。
    const resumed = await runMessageContentCompaction(conn());
    assert.equal(resumed.done, true);
    assert.equal(resumed.compactedCount, 20, "只搬剩余 20 条（已搬行天然排除）");
    assert.equal(await pendingCount(), 0);
    assert.equal(await doneMarkerCount(), 1);

    // 全量读回：120 条一条不少。
    const repo = new SqliteMessageRepository(conn());
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 120);
  });

  it("T-C8b：批内第 50 行 UPDATE 抛错——中间态双形态可读，重启后收敛（ic-25）", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    const originals: MessageContent[] = [];
    // 60 条明文行：第一批（批次 100）内第 50 行的事务抛错——单行短事务
    // 提交到一半失败的中间态，这是幂等承诺最需要保护的缝（批间中断的
    // T-C8 覆盖不到）。
    for (let i = 1; i <= 60; i++) {
      const content = mixedContent(i);
      await insertPlaintextRow(sessionId, i, content, Date.now() + i);
      originals.push(content);
    }

    const failing = wrapConnFailChatUpdateAtRow(50);
    await assert.rejects(
      () => runMessageContentCompaction(failing),
      /模拟批内中断/,
      "批内事务抛错应中断整轮（不吞——与坏行隔离的编码错误不同口径）"
    );

    // 中间态直查：前 49 行已压缩（content_encoding='zlib'、二进制 BLOB）。
    const shapes = await conn().query<{
      seq: number;
      content_encoding: string | null;
      typeOf: string | null;
      plaintext: number;
    }>(
      `SELECT seq,
              content_encoding,
              TYPEOF(content_blob) AS typeOf,
              LENGTH(content_json) AS plaintext
       FROM chat_message WHERE session_id = ? ORDER BY seq`,
      [sessionId]
    );
    assert.equal(shapes.length, 60);
    for (const row of shapes) {
      if (row.seq <= 49) {
        assert.equal(row.content_encoding, "zlib", `seq=${row.seq} 应已压缩`);
        assert.equal(row.typeOf, "blob", `seq=${row.seq} 应为二进制 BLOB`);
        assert.equal(row.plaintext, 0, `seq=${row.seq} 明文列应清空`);
      } else {
        // 第 50 行（抛错行）与未处理行（51-60）都是明文可读——读路径
        // 双形态对明文行直接读 content_json。
        assert.equal(row.content_encoding, null, `seq=${row.seq} 应仍明文`);
        assert.ok(row.plaintext > 0, `seq=${row.seq} 明文应保留`);
      }
    }

    // 双形态读回：repo 对压缩行（1-49）与明文行（50-60）都能读。
    const repo = new SqliteMessageRepository(conn());
    const midList = await repo.listBySession(sessionId);
    assert.equal(midList.length, 60);
    assert.deepEqual(midList[49]!.content, originals[49], "第 50 行明文可读");

    // 「重启」再调后收敛：谓词清零、标记已置、全部行读回原文。
    const resumed = await runMessageContentCompaction(conn());
    assert.equal(resumed.done, true);
    assert.equal(resumed.compactedCount, 11, "只搬剩余 11 条（seq 50-60）");
    assert.equal(await pendingCount(), 0);
    assert.equal(await doneMarkerCount(), 1);

    const after = await repo.listBySession(sessionId);
    assert.equal(after.length, 60, "一条不少");
    for (const msg of after) {
      assert.deepEqual(
        msg.content,
        originals[msg.seq - 1]!,
        `seq=${msg.seq} 逐字节一致`
      );
    }
  });

  it("T-C9：零丢失——混合内容（长中文/附件/tool 块）搬运前后全量逐字节比对", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    const originals: ChatMessage[] = [];
    // 50 条混合内容明文行 + 10 条走 repo.insert 的压缩行（混存搬运）。
    for (let i = 1; i <= 50; i++) {
      const content = mixedContent(i);
      await insertPlaintextRow(sessionId, i, content, Date.now() + i);
      originals.push({
        id: "",
        sessionId,
        seq: i,
        role: "user",
        content,
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      });
    }
    const repo = new SqliteMessageRepository(conn());
    for (let i = 51; i <= 60; i++) {
      const message: ChatMessage = {
        id: randomUUID(),
        sessionId,
        seq: i,
        role: "assistant",
        content: mixedContent(i),
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
        usage: { totalTokens: i * 10 },
      };
      await repo.insert(message);
      originals.push(message);
    }

    const result = await runMessageContentCompaction(conn());
    assert.equal(result.done, true);

    // 搬运前后全量逐字节比对：每条 content 的 JSON 序列化完全一致。
    const after = await repo.listBySession(sessionId);
    assert.equal(after.length, originals.length, "一条不少");
    for (const msg of after) {
      const original = originals.find((o) => o.seq === msg.seq);
      assert.ok(original, `seq=${msg.seq} 应存在`);
      assert.equal(
        JSON.stringify(msg.content),
        JSON.stringify(original.content),
        `seq=${msg.seq} 逐字节一致`
      );
    }
    // 全库明文谓词归零（spec 确认 SQL 口径）。
    assert.equal(await pendingCount(), 0);
  });

  it("批间守卫：shouldPause 命中时立即暂停，零搬运", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    await insertPlaintextRow(sessionId, 1, textBlocks("守卫验证明文行"), Date.now());

    const paused = await runMessageContentCompaction(conn(), {
      shouldPause: () => true,
    });
    assert.equal(paused.done, false);
    assert.equal(paused.compactedCount, 0, "守卫命中时零搬运");
    assert.equal(paused.stalled, false, "守卫暂停不属于 stalled 异常态");
    assert.equal(await doneMarkerCount(), 0);

    // 状态采样仍是进行中。
    const status = await getMessageCompactionStatus(conn());
    assert.equal(status.done, false);
    assert.ok(status.pendingCount >= 1);
  });
});

describe("keyset 游标与护栏（ic-05 / ic-07）", () => {
  it("ic-05：250 行（249 正常 + 1 打转行）每行恰被批 SELECT 选中一次", async () => {
    await clearDoneMarker();
    await clearPlaintextRows();
    const sessionId = await newSession();
    let stuckId = "";
    // 打转行放在中段（第 125 行位置）：游标推进的两侧都有正常行。
    for (let i = 1; i <= 250; i++) {
      const id = await insertPlaintextRow(
        sessionId,
        i,
        mixedContent(i),
        Date.now() + i
      );
      if (i === 125) {
        stuckId = id;
      }
    }
    const stuckIds = new Set([stuckId]);
    const { wrapped } = wrapConnChatUpdateNoEffect(stuckIds);

    // 探针（覆写真实连接）+ 替身（包一层定向短路）叠加：探针记录的
    // SELECT 行数即每批真实返回行数。
    const { result, records } = await withSqlProbe(() =>
      runMessageContentCompaction(wrapped)
    );

    const batchRows = records.filter((r) => isBatchSelect(r.sql) && r.rowCount > 0);
    // 游标只进不回：打转行（UPDATE 恒 changes=0、谓词仍命中）被游标
    // 推过后不再返回——每行恰被选中一次，累计 === N。反向：无游标实现
    // 下打转行每批从头重扫、累计远超 N（护栏拦停前 100+100+51+1+1+1）。
    const totalSelected = batchRows.reduce((sum, r) => sum + r.rowCount, 0);
    assert.equal(totalSelected, 250, "每行恰被批 SELECT 选中一次（累计 === N）");
    assert.equal(batchRows.length, 3, "100 + 100 + 50 恰三批（末尾另有一次空批探测）");
    const lastProbe = records.filter((r) => isBatchSelect(r.sql)).at(-1)!;
    assert.equal(lastProbe.rowCount, 0, "末次空批探测：打转行已被游标越过");
    assert.equal(result.compactedCount, 249, "只有正常行落库");
    // 打转行残留由收尾谓词校验拦下：不置标记、stalled 透出。
    assert.equal(result.done, false);
    assert.equal(result.stalled, true, "打转残留应被收尾校验拦停");
    assert.equal(await doneMarkerCount(), 0, "残留未清不得置完成标记");
    assert.equal(await pendingCount(), 1, "打转行明文保留");
  });

  it("ic-05：批 SELECT 的游标参数严格单调递增；重启（新调用）归零由谓词兜底", async () => {
    await clearDoneMarker();
    await clearPlaintextRows();
    const sessionId = await newSession();
    for (let i = 1; i <= 250; i++) {
      await insertPlaintextRow(sessionId, i, mixedContent(i), Date.now() + i);
    }

    // 阶段 1（递增断言的落点）：一次默认预算调用跑完 250 行 = 3 批，
    // 每批 SELECT 的游标参数必须严格单调递增（0 < 第一批末 rowid <
    // 第二批末 rowid）。反向：无游标实现没有该参数，断言必红。
    const { result, records } = await withSqlProbe(() =>
      runMessageContentCompaction(conn())
    );
    assert.equal(result.done, true);
    const batchCursors = records
      .filter((r) => isBatchSelect(r.sql) && r.rowCount > 0)
      .map((r) => Number(r.params[0]));
    assert.equal(batchCursors.length, 3, "100 + 100 + 50 恰三批（末尾另有一次空批探测）");
    assert.equal(batchCursors[0], 0, "首批游标从 0 起扫（rowid 恒正）");
    assert.ok(
      batchCursors[0]! < batchCursors[1]! && batchCursors[1]! < batchCursors[2]!,
      `批间游标参数应严格单调递增：${batchCursors.join(" < ")}`
    );

    // 阶段 2（syncBudgetMs:0 三轮）：游标是**单次调用**的局部加速变量，
    // 跨调用（重启）归零——这正是实现注释「游标只用于本轮加速，完成
    // 判定仍以谓词 COUNT 为准」的口径。三轮各恰搬一批，首批游标参数
    // 恒为 0，靠谓词排除已搬行推进（每轮只搬剩余行），无重复搬运。
    await clearDoneMarker();
    for (let i = 251; i <= 500; i++) {
      await insertPlaintextRow(sessionId, i, mixedContent(i), Date.now() + i);
    }
    const perRoundCompacted = [100, 100, 50];
    for (let round = 1; round <= 3; round++) {
      const roundProbe = await withSqlProbe(() =>
        runMessageContentCompaction(conn(), { syncBudgetMs: 0 })
      );
      assert.equal(roundProbe.result.done, false, `第 ${round} 轮预算耗尽返回未完成`);
      const roundSelects = roundProbe.records.filter((r) => isBatchSelect(r.sql));
      assert.equal(roundSelects.length, 1, `第 ${round} 轮恰一批`);
      assert.equal(
        Number(roundSelects[0]!.params[0]),
        0,
        `第 ${round} 轮重启归零（游标不跨调用持久，谓词兜底）`
      );
      assert.equal(
        roundProbe.result.compactedCount,
        perRoundCompacted[round - 1],
        `第 ${round} 轮只搬剩余行（谓词排除已搬行，无重复搬运）`
      );
    }
  });

  it("ic-07：打转——UPDATE 恒 changes=0 → 零进展护栏 stalled=true、标记未置", async () => {
    await clearDoneMarker();
    await clearPlaintextRows();
    const sessionId = await newSession();
    // 250 行（3 批）：全部 UPDATE 被短路成 changes=0，连续 3 个零进展批
    // 触发护栏（不要求满批——第 3 批只有 50 行也要拦）。
    for (let i = 1; i <= 250; i++) {
      await insertPlaintextRow(sessionId, i, mixedContent(i), Date.now() + i);
    }
    const { wrapped, shortCircuitedCount } = wrapConnChatUpdateNoEffect("all");

    const result = await runMessageContentCompaction(wrapped);
    assert.equal(result.stalled, true, "连续零进展应 stalled");
    assert.equal(result.done, false);
    assert.equal(result.compactedCount, 0, "没有一行真落库");
    assert.equal(await doneMarkerCount(), 0, "护栏拦停不得置完成标记");
    assert.equal(await pendingCount(), 250, "全部行明文保留");
    assert.equal(
      shortCircuitedCount(),
      250,
      "三批 100 + 100 + 50 每行一次短路后收手"
    );
  });

  it("ic-07：残留拦截——1 正常 + 1 打转 → 收尾谓词校验 done=false、stalled=true、标记未置", async () => {
    await clearDoneMarker();
    await clearPlaintextRows();
    const sessionId = await newSession();
    const okId = await insertPlaintextRow(
      sessionId,
      1,
      textBlocks("正常行"),
      Date.now()
    );
    const stuckId = await insertPlaintextRow(
      sessionId,
      2,
      textBlocks("打转行"),
      Date.now() + 1
    );
    assert.notEqual(okId, stuckId);
    const { wrapped } = wrapConnChatUpdateNoEffect(new Set([stuckId]));

    const result = await runMessageContentCompaction(wrapped);
    // 批 1 搬走正常行（batchChanges=1 清零护栏计数）→ 游标推过两行 →
    // 批 2 空批收尾 → 谓词仍剩打转行 1 > 已知坏行 0 → 拦截（这正是
    // 「游标扫完但谓词非空」的残留事故形态：无收尾校验会置标记、残留
    // 行被永久跳过）。
    assert.equal(result.done, false);
    assert.equal(result.stalled, true);
    assert.equal(result.compactedCount, 1, "正常行照常搬走");
    assert.equal(await doneMarkerCount(), 0, "残留未清不得置完成标记");
    assert.equal(await pendingCount(), 1, "打转行明文保留在谓词里");
  });
});

describe("写侧不变量守护（OQ-I7）", () => {
  it("OQ-I7：content_encoding 非空 ⇒ content_json = ''（压缩行与明文行混存互斥）", async () => {
    await clearDoneMarker();
    const sessionId = await newSession();
    // 明文行（直插，模拟存量库）× 3 + 压缩行（走 repo.insert 写侧编码）× 2
    // ——混存态正是迁移中间态，两列互斥不变量在此时就要守住。
    for (let i = 1; i <= 3; i++) {
      await insertPlaintextRow(sessionId, i, mixedContent(i), Date.now() + i);
    }
    const repo = new SqliteMessageRepository(conn());
    for (let i = 4; i <= 5; i++) {
      await repo.insert({
        id: randomUUID(),
        sessionId,
        seq: i,
        role: "assistant",
        content: mixedContent(i),
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
      });
    }

    // 互斥不变量：encoding 非空的行 content_json 必为 ''（反之明文行
    // 的 encoding 必为 NULL——两列只能有一个承载正文）。计数限定本
    // session（共享库上其它用例的行不参与本用例的夹具账目）。
    const violatedWhileMixed = await conn().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE content_encoding IS NOT NULL AND content_json != ''`
    );
    assert.equal(Number(violatedWhileMixed[0]!.n), 0, "混存态互斥不破（全库）");

    const compressedShapes = await conn().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE session_id = ?
         AND content_encoding IS NOT NULL
         AND content_json = '' AND TYPEOF(content_blob) = 'blob'`,
      [sessionId]
    );
    assert.equal(Number(compressedShapes[0]!.n), 2, "压缩行：blob 二进制 + 明文空");

    const plaintextShapes = await conn().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE session_id = ? AND content_encoding IS NULL AND content_json != ''`,
      [sessionId]
    );
    assert.equal(Number(plaintextShapes[0]!.n), 3, "明文行：encoding 为 NULL");

    // 跑完一轮后全表进压缩形态，互斥依旧守得住。
    const result = await runMessageContentCompaction(conn());
    assert.equal(result.done, true);
    const violatedAfter = await conn().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE content_encoding IS NOT NULL AND content_json != ''`
    );
    assert.equal(Number(violatedAfter[0]!.n), 0, "搬运后互斥不破");

    const allCompressed = await conn().query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE session_id = ? AND content_encoding = 'zlib' AND content_json = ''`,
      [sessionId]
    );
    assert.equal(Number(allCompressed[0]!.n), 5, "本 session 全部行进压缩形态");

    // 读回仍等价（5 条一条不少）。
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 5);
  });
});
