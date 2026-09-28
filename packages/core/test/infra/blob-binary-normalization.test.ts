/**
 * 存量 blob 行形态归一任务用例（T-BB4 ~ T-BB7 + 标记短路面 + chat_message
 * 适配器 + cr-fix-spec r4 验收族）。
 *
 * 归一口径见 spec「Part A 归一任务」：谓词 `encoding = 'zlib-b64' OR
 * (encoding = 'zlib' AND TYPEOF(bytes) = 'text')`，批 ≤100 行短事务，
 * 每表各自置 KKV 完成标记（两段式 nm-blob-binary / vfsContentDone /
 * fileCacheDone / messageContentDone）。chat_message（A2 适配器）列名为
 * content_encoding / content_blob、无 byte_len 列，legacy 明文行
 * （content_encoding IS NULL）不命中谓词——那是 compaction 任务的谓词范围。
 *
 * 测试数据一律**直插 SQL 构造**（不依赖写侧 codec），并显式把 `byte_len`
 * 写成三态混杂的历史形态，验证归一后一律重算为物理字节长度。
 *
 * 每个用例开头 {@link resetNormalizationState} 清三表谓词命中行 + 完成
 * 标记：共享库上用例自管状态（口径照 message-content-compaction.test.ts
 * 的 clearDoneMarker），用例之间互不污染计数。
 *
 * 【ic-06① 节流串值】getBlobBinaryStatus 的谓词 COUNT 路径带 3s 模块级
 * 节流（按连接实例缓存未完成态采样值），共享连接的用例之间会串值——
 * {@link resetNormalizationState} 同时调 `__resetStatusSamplingThrottle
 * ForTests()` 清节流缓存（「用例间清理」的既定缝，见实现侧导出注释）。
 * 验收用例在独立进程的 status-sampling-throttle.test.ts 里承载。
 *
 * base64 文本在测试内用 `Buffer` 现场编码，不引 blob-bytes-codec 的
 * `bytesToBase64`（A1 已删该导出，生产端无调用方）。
 *
 * 【cr-31 NF-1 · 与姊妹文件的分工】本文件负责主循环 / 收尾谓词校验 /
 * 门条件 / 幂等 / 状态查询等既有覆盖，维护链路的判据止于 `maintCalls`
 * （「是否进入维护段」，见 {@link maintenanceCounter}）；「pending 标记的
 * 补跑与清除」（判据是标记状态）在独立进程的
 * `blob-binary-normalization-maintenance.test.ts` 里承载，两文件互不复制
 * 用例。
 *
 * @module test/infra/blob-binary-normalization
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SqliteKkvRepository } from "../../src/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import {
  compressZlib,
  decodeCompressedBytes,
  decompressZlib,
} from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import { SqliteVfsContentStore } from "../../src/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import type { Row, SqlValue } from "../../src/infra/tdbc/types.js";
import {
  BLOB_BINARY_KKV_MODULE,
  getBlobBinaryStatus,
  runBlobBinaryNormalization,
  runStartupMaintenanceOnce,
  type RunBlobBinaryNormalizationOptions,
} from "../../src/infra/db-maintenance/index.js";
import { __resetStatusSamplingThrottleForTests } from "../../src/infra/db-maintenance/impl/blob-binary-normalization.js";
import {
  createSessionKkvService,
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "../../src/service/session-kkv/index.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

novelMasterTestFixture();

/** 归一谓词（与实现同形，测试侧直查断言用）。 */
const PREDICATE = `(encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text'))`;

/** chat_message 侧同形谓词（列名不同）。 */
const MESSAGE_PREDICATE = `(content_encoding = 'zlib-b64' OR (content_encoding = 'zlib' AND TYPEOF(content_blob) = 'text'))`;

/** 本轮注册的两张 blob 表。 */
type BlobTable = "vfs_content_blob" | "session_file_cache_blob";

/** `byte_len` 存量三态：base64 文本长度 / 二进制长度 / 二进制长度 −2。 */
type ByteLenStyle = "base64" | "binary" | "binaryMinusTwo";

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

/**
 * 谓词命中行清零 + 完成/兜底标记清零（用例自管状态的地基）。
 *
 * @remarks ic-27：chat_message 的 DELETE 限定 `id LIKE 'bb-msg-%'`——本
 * 文件插入的 chat_message 夹具统一带 `bb-msg-` 前缀，只清本文件前缀夹具，
 * 避免越界影响共享库其它用例（谓词命中的非本文件行不得被顺手删掉）。
 */
async function resetNormalizationState(): Promise<void> {
  // ic-06①：共享连接上清节流缓存——前序用例的未完成态采样不得在 3s
  // 窗口内串值到本用例（见文件头注释「节流串值」段）。
  __resetStatusSamplingThrottleForTests();
  const c = conn();
  await c.execute(`DELETE FROM vfs_content_blob WHERE ${PREDICATE}`);
  await c.execute(`DELETE FROM session_file_cache_blob WHERE ${PREDICATE}`);
  await c.execute(
    `DELETE FROM chat_message WHERE ${MESSAGE_PREDICATE} AND id LIKE 'bb-msg-%'`
  );
  await c.execute("DELETE FROM session_file_cache_entry WHERE key LIKE 'bb-%'");
  await c.execute("DELETE FROM kkv_entry WHERE module = ?", [
    BLOB_BINARY_KKV_MODULE,
  ]);
}

async function pendingCount(table: BlobTable): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${PREDICATE}`
  );
  return Number(rows[0]?.n ?? 0);
}

async function setDoneMarker(doneKey: string): Promise<void> {
  await new SqliteKkvRepository(conn()).set(
    BLOB_BINARY_KKV_MODULE,
    doneKey,
    new Date().toISOString()
  );
}

/**
 * 直插一条存量 base64 文本行。
 *
 * @param encoding 落库 encoding（`zlib-b64` 正规存量 / `zlib` 脏形态）。
 * @param byteLenStyle `byte_len` 写法（三态混杂，验证归一后一律重算）。
 */
async function insertLegacyRow(
  table: BlobTable,
  contentHash: string,
  plain: string,
  encoding = "zlib-b64",
  byteLenStyle: ByteLenStyle = "base64"
): Promise<Uint8Array> {
  const c = conn();
  const compressed = compressZlib(new TextEncoder().encode(plain));
  const b64 = Buffer.from(compressed).toString("base64");
  const byteLen =
    byteLenStyle === "base64"
      ? b64.length
      : byteLenStyle === "binary"
        ? compressed.byteLength
        : compressed.byteLength - 2;
  if (table === "vfs_content_blob") {
    await c.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES (?, ?, ?, ?, 0)`,
      [contentHash, encoding, b64, byteLen]
    );
  } else {
    await c.execute(
      `INSERT INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len)
       VALUES (?, ?, ?, ?)`,
      [contentHash, encoding, b64, byteLen]
    );
    // 补一条 entry 引用行：维护链路的 file_cache GC 只删无引用 blob 行，
    // 不补引用会让完成收尾的 GC 把本用例的语料扫掉。
    await c.execute(
      `INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms)
       VALUES ('bb-session', ?, ?, 0)`,
      [contentHash, contentHash]
    );
  }
  return compressed;
}

/**
 * 直插一条 base64 非法的存量行（解码必失败的坏行）。
 *
 * @remarks 坏行只往 `vfs_content_blob` 插：file_cache 表的坏行还得补
 * entry 引用行（否则完成收尾的 GC 会把行扫掉），而坏行断言不需要走
 * file_cache。
 */
async function insertCorruptRow(
  contentHash: string,
  badText = "not-base64!!"
): Promise<void> {
  await conn().execute(
    `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
     VALUES (?, 'zlib-b64', ?, ?, 0)`,
    [contentHash, badText, badText.length]
  );
}

/** 读回一行的解码明文（走读侧共享 codec，兼容归一前后的全部形态）。 */
async function readPlain(
  table: BlobTable,
  contentHash: string
): Promise<string> {
  const rows = await conn().query<{ encoding: string; bytes: SqlValue }>(
    `SELECT encoding, bytes FROM ${table} WHERE content_hash = ?`,
    [contentHash]
  );
  assert.equal(rows.length, 1, `${table} 应有一行 ${contentHash}`);
  const compressed = decodeCompressedBytes(
    String(rows[0]!.encoding),
    rows[0]!.bytes,
    `${table}.bytes`
  );
  return new TextDecoder().decode(decompressZlib(compressed));
}

/** 混合语料：长中文 + 长 base64 样串 + 工具块 JSON。 */
function corpus(i: number): string {
  return [
    `第 ${i} 段长中文：${"混排标点与数字 0123456789 的长正文内容。".repeat(40 + (i % 5))}`,
    `base64样串：${"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5".repeat(20)}`,
    `工具块：${JSON.stringify({ type: "tool_use", id: `tu-${i}`, input: { path: `/第${i}章.md` } })}`,
  ].join("\n");
}

/** 行形态快照（幂等断言用：数据未变）。 */
interface RowShape {
  readonly encoding: string;
  readonly typeOf: string;
  readonly byteLen: number;
  readonly physicalLen: number;
}

async function snapshotShapes(table: BlobTable, prefix: string): Promise<RowShape[]> {
  const rows = await conn().query<{
    encoding: string;
    typeOf: string;
    byte_len: number;
    physical: number;
  }>(
    `SELECT encoding, TYPEOF(bytes) AS typeOf, byte_len, LENGTH(bytes) AS physical
     FROM ${table} WHERE content_hash LIKE '${prefix}%' ORDER BY content_hash`
  );
  return rows.map((r) => ({
    encoding: String(r.encoding),
    typeOf: String(r.typeOf),
    byteLen: Number(r.byte_len),
    physicalLen: Number(r.physical),
  }));
}

/** 探针覆写的连接成员（覆 `query` / `execute` / `transaction`，其余不动）。 */
type ProbedConn = {
  query: TdbcConnection["query"];
  execute: TdbcConnection["execute"];
  transaction: TdbcConnection["transaction"];
};

/** 探针覆写的 tx 成员（只覆 `execute`）。 */
type ProbedTx = {
  execute: TdbcConnection["execute"];
};

/**
 * 包一层 SQL 探针：记录本轮实际下发给连接（含事务内 `tx`）的 SQL。
 *
 * @remarks 按**连接端口**全量拦截（`query` / `execute` / `transaction`），
 * 不依赖实现当前用到哪几个口——cr-08 起一并覆写 `conn.execute`：若实现
 * 把语句改走 execute（合法重构），探针不会静默漏记。用完在 `finally` 里
 * 用 **delete** 撤 own-property（共享连接不能带伤往下传；赋回 bound 函数
 * 会在共享 conn 上留下 own-property 遮蔽原型方法——cr-15）。
 */
async function withSqlProbe<T>(
  fn: () => Promise<T>
): Promise<{ result: T; seen: string[] }> {
  const c = conn();
  const seen: string[] = [];
  const originalQuery = c.query;
  const originalExecute = c.execute;
  const originalTransaction = c.transaction;
  const probe = c as unknown as ProbedConn;
  probe.query = ((sql: string, parameters?: readonly unknown[]) => {
    seen.push(sql);
    return originalQuery.call(c, sql, parameters);
  }) as TdbcConnection["query"];
  probe.execute = ((sql: string, parameters?: readonly unknown[]) => {
    seen.push(sql);
    return originalExecute.call(c, sql, parameters);
  }) as TdbcConnection["execute"];
  probe.transaction = (<T>(inner: (tx: TdbcConnection) => Promise<T>) =>
    originalTransaction.call(c, async (tx) => {
      const originalTxExecute = tx.execute;
      const txProbe = tx as unknown as ProbedTx;
      txProbe.execute = ((sql: string, parameters?: readonly unknown[]) => {
        seen.push(sql);
        return originalTxExecute.call(tx, sql, parameters);
      }) as TdbcConnection["execute"];
      try {
        return await inner(tx);
      } finally {
        delete (txProbe as Partial<ProbedTx>).execute;
      }
    })) as TdbcConnection["transaction"];
  try {
    return { result: await fn(), seen };
  } finally {
    // delete 撤 own-property → 原型上的原生实现重新可见（cr-15：不是赋回）。
    delete (probe as Partial<ProbedConn>).query;
    delete (probe as Partial<ProbedConn>).execute;
    delete (probe as Partial<ProbedConn>).transaction;
  }
}

/**
 * 维护段观测计数器（cr-31 NF-1 的观测缝）。
 *
 * `maintCalls` 的语义（每条用到它的用例注释里都会重申）：**「进入收尾维护
 * 段的次数（含被进程级去重短路的调用）」**，即 `afterMaintenance` 被调的
 * 次数——**不代表 VACUUM 真跑**。`runStartupMaintenanceOnce` 的进程级去重
 * 标记是执行前置位、失败不回滚，被短路时它返回 `null` 但维护段已经进入
 * （`beforeMaintenance` 早于它执行）；且本文件第一条用例（VACUUM 容错）
 * 必然消费掉该标记，后续 VACUUM 类断言在本文件恒真、不可用。回调缝与
 * 实现同源、无新增公共 API，是当前唯一可靠判据。
 */
function maintenanceCounter(): {
  readonly maintCalls: () => number;
  readonly hooks: Pick<
    RunBlobBinaryNormalizationOptions,
    "beforeMaintenance" | "afterMaintenance"
  >;
} {
  let calls = 0;
  return {
    maintCalls: () => calls,
    hooks: {
      afterMaintenance: () => {
        calls += 1;
      },
    },
  };
}

/** 两张 blob 表的 UPDATE 识别（探针与零进展替身共用同一口径）。 */
function isBlobTableUpdate(sql: string): boolean {
  return /^\s*UPDATE\s+(?:vfs_content_blob|session_file_cache_blob)\b/i.test(sql);
}

/** chat_message 的 UPDATE 识别（与 isBlobTableUpdate 同口径，三表断言用）。 */
function isChatMessageUpdate(sql: string): boolean {
  return /^\s*UPDATE\s+chat_message\b/i.test(sql);
}

/**
 * 让 blob 表 UPDATE 恒返回 `changes = 0` 的连接替身。
 *
 * 模拟「写回不生效」——典型是某端驱动把二进制值绑成 TEXT 存回，谓词下一轮
 * 仍反复命中同一批行。UPDATE **不真正执行**（直接短路返回），行原样留在
 * 谓词里，收尾谓词校验 / 零进展护栏的输入就此造好。
 *
 * @param targetKeys 只短路主键命中集合的 UPDATE（构造「个别行打转、其余
 * 正常收敛」的夹具，cr-02 反例用）；缺省短路**全部** blob 表 UPDATE。
 *
 * @remarks 归一任务只用到 `conn.query` / `conn.transaction` / `conn.execute`，
 * 替身按这三个口最小实现，**不改生产代码结构**；非 blob 表的语句照常转发
 * 给真实事务，KKV 完成标记的写入仍能落库——这样断言的才是「收尾校验收手
 * 故未置标记」，而不是「写不进去」。
 */
function wrapConnBlobUpdateNoEffect(
  targetKeys?: readonly string[]
): {
  readonly conn: TdbcConnection;
  /** 被短路的 blob 表 UPDATE 次数（每表一轮批 = 1 次）。 */
  readonly updateCount: () => number;
} {
  const c = conn();
  let updates = 0;
  const isTargetUpdate = (sql: string, parameters?: readonly unknown[]) =>
    isBlobTableUpdate(sql) &&
    (targetKeys == null ||
      parameters?.some((p) => targetKeys.includes(String(p))) === true);
  const wrapTx = (realTx: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      if (isTargetUpdate(sql, parameters)) {
        updates += 1;
        return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
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
  return { conn: wrapTx(c), updateCount: () => updates };
}

describe("存量 blob 形态归一任务（T-BB4 ~ T-BB7）", () => {
  /**
   * 【cr-31 / fix-spec K 节第 1 条 · 文档性防护】「VACUUM 容错用例必须是本
   * 文件第一条用例」是进程级隐式约束：该用例会消费 `runStartupMaintenanceOnce`
   * 的进程级去重标记（模块私有布尔，无法在不消费的前提下直接断言它），从
   * 而影响后续用例对「维护链路是否执行」的观测。本钩子能落成真断言的是
   * **持久化侧**：`kkv_entry` 里不得残留 `startupMaintenancePending`（维护
   * 失败兜底标记，残留会伪造「强制补跑」输入）。注意它**不解决可观测性**
   * ——「维护段是否被进入」的观测一律由 beforeMaintenance / afterMaintenance
   * 回调缝承担（见 {@link maintenanceCounter}），两者职责不同、互不替代。
   */
  before(async () => {
    assert.equal(
      await new SqliteKkvRepository(conn()).get(
        BLOB_BINARY_KKV_MODULE,
        "startupMaintenancePending"
      ),
      null,
      "文件起始不得残留 startupMaintenancePending 兜底标记"
    );
  });

  /**
   * 收尾维护链路抛错（磁盘满 / 库被锁时的 VACUUM 失败）只 warn、不上抛。
   *
   * @remarks **必须声明为本文件第一条用例**：`runStartupMaintenanceOnce` 是
   * 模块级进程去重（标记执行前置、失败不回滚），本进程内首个调用者才会真
   * 跑维护链路。若前面已有用例跑过归一并消费了去重标记，这条用例就短路成
   * 「什么都没跑」，断言会失去意义。r3 起该约束的理由是「它消费进程级
   * 去重标记、直接影响后续用例对**维护链路本身是否执行**的观测」——后续
   * 用例的观测一律改走 `maintCalls` 回调缝（见
   * {@link maintenanceCounter}），不再依赖 VACUUM 出现次数。文件头的
   * `before` 钩子是这条顺序约束的文档性防护。
   */
  it("收尾维护链路失败（VACUUM 抛错）只 warn：归一结果照常返回，不影响启动链路", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-vacuum-v", corpus(91));

    // VACUUM 直接抛（模拟磁盘满 / 库被锁），其余语句照常走真实连接。
    const c = conn();
    const wrapped: TdbcConnection = {
      execute: async (sql, parameters) => {
        if (/^\s*VACUUM\b/i.test(sql)) {
          throw new Error("模拟磁盘满：VACUUM 失败");
        }
        return await c.execute(sql, parameters);
      },
      query: <R extends Row>(sql, parameters) => c.query<R>(sql, parameters),
      batch: (sql, parametersList) => c.batch(sql, parametersList),
      transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>) =>
        c.transaction<T>((nested) => fn(nested)),
      close: () => c.close(),
    };

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    let result: Awaited<ReturnType<typeof runBlobBinaryNormalization>>;
    try {
      // 关键：不抛。归一数据已落好，维护失败只丢空间回收。
      result = await runBlobBinaryNormalization(wrapped);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(result!.done, true, "维护失败不影响归一完成态");
    assert.equal(result!.normalizedCount, 1, "数据已落好");
    assert.ok(
      warnings.some((line) => line.includes("收尾维护链路")),
      "维护失败应只 warn 告警"
    );
    assert.equal(await pendingCount("vfs_content_blob"), 0);
    assert.ok(
      await new SqliteKkvRepository(conn()).get(
        BLOB_BINARY_KKV_MODULE,
        "vfsContentDone"
      ),
      "完成标记照置"
    );
  });

  it("T-BB4：幂等——连跑两遍，第二遍 normalizedCount=0、不下发 UPDATE 且数据未变", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-idem-1", corpus(1));
    await insertLegacyRow("vfs_content_blob", "bb-idem-2", corpus(2));
    await insertLegacyRow("session_file_cache_blob", "bb-idem-3", corpus(3));

    // 未完成态采样：两张 blob 表 pendingCount ≥ 1；chat_message 空表
    // （谓词零命中）等价完成态。
    const before = await getBlobBinaryStatus(conn());
    assert.equal(before.tables.length, 3);
    for (const table of before.tables) {
      if (table.table === "messageContent") {
        assert.deepEqual(table, {
          table: "messageContent",
          done: true,
          pendingCount: 0,
          failedCount: 0,
        });
        continue;
      }
      assert.equal(table.done, false, `${table.table} 应处于进行中`);
      assert.ok(table.pendingCount >= 1, `${table.table} 剩余行 ≥ 1`);
    }

    const first = await runBlobBinaryNormalization(conn());
    assert.equal(first.done, true);
    assert.equal(first.stalled, false, "正常收敛不报停机");
    assert.equal(first.normalizedCount, 3);
    assert.equal(await pendingCount("vfs_content_blob"), 0, "谓词应清空");
    assert.equal(await pendingCount("session_file_cache_blob"), 0);
    const afterFirst = {
      vfs: await snapshotShapes("vfs_content_blob", "bb-idem"),
      cache: await snapshotShapes("session_file_cache_blob", "bb-idem"),
    };

    // 第二遍：完成标记已置 → 零归一、**不下发任何 blob 表 UPDATE**、数据
    // 逐字段未变。探针覆盖连接口（query/execute）与事务内 tx 两个下发路径。
    // 【cr-07 r2】本用例只覆盖**标记短路路径**（readDoneMarker → continue，
    // normalizeTable 根本不被调用），无论谓词写得多离谱它都绿——**结构上
    // 不可能长牙**；「谓词幂等」由文件尾部的「清标记后第二遍」用例单独
    // 钉住，不要指望本用例在清掉标记后仍成立。
    const second = await withSqlProbe(() => runBlobBinaryNormalization(conn()));
    assert.equal(second.result.done, true);
    assert.equal(second.result.stalled, false);
    assert.equal(second.result.normalizedCount, 0, "第二遍零归一");
    assert.equal(
      second.seen.filter((sql) => isBlobTableUpdate(sql)).length,
      0,
      "标记已置后不得再下发 vfs_content_blob / session_file_cache_blob 的 UPDATE（路径覆盖级：证短路时不多跑）"
    );
    assert.equal(
      second.seen.filter((sql) => isChatMessageUpdate(sql)).length,
      0,
      "chat_message 同口径（三表标记短路互不牵连）"
    );
    assert.deepEqual(await snapshotShapes("vfs_content_blob", "bb-idem"), afterFirst.vfs);
    assert.deepEqual(
      await snapshotShapes("session_file_cache_blob", "bb-idem"),
      afterFirst.cache
    );

    // 完成后状态采样为 done=true（零 COUNT 口径，failedCount 来自标记快照）。
    const after = await getBlobBinaryStatus(conn());
    for (const table of after.tables) {
      assert.deepEqual(table, {
        table: table.table,
        done: true,
        pendingCount: 0,
        failedCount: 0,
      });
    }
  });

  it("T-BB5：可重入——批间中断（模拟杀进程）后重启续跑收敛", async () => {
    await resetNormalizationState();
    // 120 条存量行：第一轮（预算 0ms）搬完第一批 100 行即中断，
    // 剩余 20 条由第二次调用收敛（两表无 rowid，按主键排序分批）。
    for (let i = 1; i <= 120; i++) {
      await insertLegacyRow(
        "vfs_content_blob",
        `bb-enter-${String(i).padStart(6, "0")}`,
        corpus(i)
      );
    }

    const interrupted = await runBlobBinaryNormalization(conn(), {
      syncBudgetMs: 0,
    });
    assert.equal(interrupted.done, false, "预算耗尽应返回未完成");
    assert.equal(interrupted.normalizedCount, 100, "第一批 100 行已归一");
    assert.equal(await pendingCount("vfs_content_blob"), 20, "中断时剩余 20 条");
    const marker = await new SqliteKkvRepository(conn()).get(
      BLOB_BINARY_KKV_MODULE,
      "vfsContentDone"
    );
    assert.equal(marker, null, "中断时完成标记未置");

    // 【cr-10】中断轮内另一（两）张表照常收敛置标记：三表各自短路、互不
    // 牵连——vfs 预算耗尽不会拖住空表的 fileCache / messageContent 完成。
    // （适配器顺序 vfs → fileCache → messageContent，后两张在中断轮内
    // 正常跑完。）
    const fileCacheMarker = await new SqliteKkvRepository(conn()).get(
      BLOB_BINARY_KKV_MODULE,
      "fileCacheDone"
    );
    assert.ok(fileCacheMarker, "中断轮内 fileCache 标记仍置（互不牵连）");
    const messageMarker = await new SqliteKkvRepository(conn()).get(
      BLOB_BINARY_KKV_MODULE,
      "messageContentDone"
    );
    assert.ok(messageMarker, "中断轮内 messageContent 标记仍置（互不牵连）");

    // 模拟重启：重新调用（默认预算），谓词重扫续跑收敛。
    const resumed = await runBlobBinaryNormalization(conn());
    assert.equal(resumed.done, true);
    assert.equal(resumed.normalizedCount, 20, "只搬剩余 20 条（已归一行天然排除）");
    assert.equal(await pendingCount("vfs_content_blob"), 0);
    const doneMarker = await new SqliteKkvRepository(conn()).get(
      BLOB_BINARY_KKV_MODULE,
      "vfsContentDone"
    );
    assert.ok(doneMarker, "续跑收敛后完成标记已置");

    // 全量读回：120 条一条不少。
    const rows = await conn().query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash LIKE 'bb-enter-%'"
    );
    assert.equal(Number(rows[0]?.n ?? 0), 120);
  });

  it("T-BB6：形态一致——encoding=zlib、TYPEOF=blob、byte_len=物理字节长度", async () => {
    await resetNormalizationState();
    // 覆盖两种存量 encoding × byte_len 三态写法。
    const styles: Array<[string, ByteLenStyle]> = [
      ["zlib-b64", "base64"],
      ["zlib-b64", "binary"],
      ["zlib-b64", "binaryMinusTwo"],
      ["zlib", "base64"],
      ["zlib", "binaryMinusTwo"],
    ];
    const tables: BlobTable[] = ["vfs_content_blob", "session_file_cache_blob"];
    const expected = new Map<string, number>();
    for (const table of tables) {
      for (let i = 0; i < styles.length; i++) {
        const [encoding, style] = styles[i]!;
        const hash = `bb-shape-${table === "vfs_content_blob" ? "v" : "f"}-${i}`;
        const compressed = await insertLegacyRow(table, hash, corpus(i + 1), encoding, style);
        expected.set(`${table}:${hash}`, compressed.byteLength);
      }
    }

    const result = await runBlobBinaryNormalization(conn());
    assert.equal(result.done, true);
    assert.equal(result.normalizedCount, 10);

    for (const table of tables) {
      const rows = await conn().query<{
        content_hash: string;
        encoding: string;
        typeOf: string;
        byte_len: number;
        physical: number;
      }>(
        `SELECT content_hash, encoding, TYPEOF(bytes) AS typeOf,
                byte_len, LENGTH(bytes) AS physical
         FROM ${table} WHERE content_hash LIKE 'bb-shape-%' ORDER BY content_hash`
      );
      assert.equal(rows.length, styles.length);
      for (const row of rows) {
        assert.equal(row.encoding, "zlib", "encoding 归一为 zlib");
        assert.equal(row.typeOf, "blob", "bytes 落为二进制 BLOB");
        assert.equal(
          Number(row.byte_len),
          Number(row.physical),
          "byte_len = 物理字节长度"
        );
        assert.equal(
          Number(row.byte_len),
          expected.get(`${table}:${String(row.content_hash)}`),
          "byte_len = 解码后二进制长度（不受存量写法影响）"
        );
      }
    }
  });

  it("T-BB7：零丢失——混合语料归一前后逐条解压比对全等", async () => {
    await resetNormalizationState();
    const tables: BlobTable[] = ["vfs_content_blob", "session_file_cache_blob"];
    const inserted: Array<{ table: BlobTable; hash: string; plain: string }> = [];
    for (const table of tables) {
      for (let i = 1; i <= 12; i++) {
        const plain = corpus(i);
        // content_hash 取真实 sha256：让归一后还能走读路径
        // （SqliteVfsContentStore.get）复核，而不只是直查 SQL。
        const hash = table === "vfs_content_blob" ? hashContent(plain) : `bb-zero-${i}`;
        const encoding = i % 4 === 0 ? "zlib" : "zlib-b64";
        await insertLegacyRow(table, hash, plain, encoding, "base64");
        inserted.push({ table, hash, plain });
      }
    }

    const result = await runBlobBinaryNormalization(conn());
    assert.equal(result.done, true);
    assert.equal(result.normalizedCount, inserted.length);

    for (const item of inserted) {
      assert.equal(
        await readPlain(item.table, item.hash),
        item.plain,
        `${item.table} ${item.hash} 归一前后逐字节一致`
      );
    }

    // 【cr-11】file_cache 侧行再走真实读链路（createSessionKkvService：
    // entry 引用行 → blob 两跳 → 解压 → serializeFileCachePayload），与
    // vfs 侧 SqliteVfsContentStore 的真实读复核对称——写侧若在
    // store/service 层引入形态 bug（读时按 encoding 走错分支），直查 SQL
    // 的比对测不出来。get 返回 FileCachePayload JSON（body + mtimeMs），
    // 断言落 body 与夹具 entry 行的 mtime_ms=0（insertLegacyRow 已插好
    // entry 引用行，无需额外造数据）。
    const sessionKkv = createSessionKkvService(conn());
    for (const item of inserted) {
      if (item.table !== "session_file_cache_blob") {
        continue;
      }
      const roundTrip = await sessionKkv.get(
        "bb-session",
        SESSION_KKV_DOMAIN_FILE_CACHE,
        item.hash
      );
      assert.ok(roundTrip != null, `file_cache 真实读链路应命中 ${item.hash}`);
      const payload = JSON.parse(roundTrip) as { body: string; mtimeMs: number };
      assert.equal(
        payload.body,
        item.plain,
        "file_cache 真实读链路应还原原文（body）"
      );
      assert.equal(payload.mtimeMs, 0, "entry 引用行 mtime_ms=0 透传");
    }

    // 读路径复核：vfs content store 走真实解码链路取回明文。
    const store = new SqliteVfsContentStore(conn());
    for (let i = 1; i <= 12; i++) {
      const plain = corpus(i);
      assert.equal(await store.get(hashContent(plain)), plain, "读路径等值");
    }
  });

  it("历史脏形态：encoding='zlib' 但存 base64 文本的行也被归一", async () => {
    await resetNormalizationState();
    // 只插 zlib + 文本形态：谓词的 TYPEOF 分支单独生效。
    await insertLegacyRow("vfs_content_blob", "bb-dirty-v", corpus(41), "zlib");
    await insertLegacyRow(
      "session_file_cache_blob",
      "bb-dirty-f",
      corpus(42),
      "zlib"
    );
    assert.equal(await pendingCount("vfs_content_blob"), 1);
    assert.equal(await pendingCount("session_file_cache_blob"), 1);

    const result = await runBlobBinaryNormalization(conn());
    assert.equal(result.done, true);
    assert.equal(result.normalizedCount, 2);

    for (const table of ["vfs_content_blob", "session_file_cache_blob"] as const) {
      const rows = await conn().query<{ typeOf: string; byte_len: number }>(
        `SELECT TYPEOF(bytes) AS typeOf, byte_len FROM ${table}
         WHERE content_hash LIKE 'bb-dirty-%'`
      );
      assert.equal(rows.length, 1);
      assert.equal(String(rows[0]!.typeOf), "blob");
      assert.ok(Number(rows[0]!.byte_len) > 0);
    }
    assert.equal(await readPlain("vfs_content_blob", "bb-dirty-v"), corpus(41));
    assert.equal(
      await readPlain("session_file_cache_blob", "bb-dirty-f"),
      corpus(42)
    );
  });

  it("解码失败的坏行不阻断收敛：坏行原样保留、failedCount=1、标记照置、第二遍幂等", async () => {
    await resetNormalizationState();
    for (let i = 1; i <= 3; i++) {
      await insertLegacyRow("vfs_content_blob", `bb-bad-good-${i}`, corpus(60 + i));
    }
    await insertCorruptRow("bb-bad-corrupt");
    const badBefore = await snapshotShapes("vfs_content_blob", "bb-bad-corrupt");
    assert.equal(badBefore.length, 1);
    assert.equal(badBefore[0]!.typeOf, "text", "坏行前置形态应为 TEXT");

    // 关键：不抛。整轮跑完且把坏行记进 failedCount。
    const first = await runBlobBinaryNormalization(conn());
    assert.equal(first.done, true, "坏行不阻断完成态");
    assert.equal(first.normalizedCount, 3, "正常行全部归一");
    assert.equal(first.failedCount, 1, "坏行被跳过并计数");
    assert.equal(
      await pendingCount("vfs_content_blob"),
      1,
      "谓词里只剩那条坏行"
    );

    // 坏行原样保留：encoding / TYPEOF / byte_len / 物理长度一字未改。
    assert.deepEqual(
      await snapshotShapes("vfs_content_blob", "bb-bad-corrupt"),
      badBefore,
      "坏行必须原样保留、不写库"
    );
    // 同批的正常行照常归一、可解码回原文。
    for (let i = 1; i <= 3; i++) {
      assert.equal(
        await readPlain("vfs_content_blob", `bb-bad-good-${i}`),
        corpus(60 + i)
      );
    }
    // 标记照置：否则每次启动都要重扫坏行、任务永远收敛不了。
    const kkv = new SqliteKkvRepository(conn());
    assert.ok(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "vfsContentDone"),
      "有坏行也置完成标记"
    );

    // 第二遍：标记已置 → 零归一、不再解码坏行（幂等）。
    const second = await runBlobBinaryNormalization(conn());
    assert.equal(second.done, true);
    assert.equal(second.normalizedCount, 0);
    assert.equal(second.failedCount, 0, "标记已置后不再扫坏行");
    assert.deepEqual(
      await snapshotShapes("vfs_content_blob", "bb-bad-corrupt"),
      badBefore
    );
  });

  it("shouldPause 守卫：首轮即暂停返回 done=false、零归一、两表标记均未置", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-pause-v", corpus(71));
    await insertLegacyRow("session_file_cache_blob", "bb-pause-f", corpus(72));

    const paused = await runBlobBinaryNormalization(conn(), {
      shouldPause: () => true,
    });
    assert.equal(paused.done, false, "暂停即未完成");
    assert.equal(paused.stalled, false, "守卫暂停不是零进展护栏");
    assert.equal(paused.normalizedCount, 0, "暂停时一行都不搬");
    assert.equal(paused.failedCount, 0);

    // 两表各一行仍在谓词里：守卫在批粒度生效，语料未被搬走。
    assert.equal(await pendingCount("vfs_content_blob"), 1);
    assert.equal(await pendingCount("session_file_cache_blob"), 1);

    const kkv = new SqliteKkvRepository(conn());
    assert.equal(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "vfsContentDone"),
      null,
      "暂停时不得置 vfsContent 标记"
    );
    assert.equal(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "fileCacheDone"),
      null,
      "暂停时不得置 fileCache 标记"
    );
  });

  it("收尾谓词校验判定残留非坏行 → stalled:true、标记未置", async () => {
    await resetNormalizationState();
    // 每表只放 1 行（< BATCH_SIZE）：UPDATE 恒 changes=0（写回不生效），
    // 游标推过该行后下一批取空、循环以「整表扫完」退出——真正的证物是
    // **收尾谓词校验**拦住了残留行（leftover 1 > failedKeys 0），不再是
    // 「3 批护栏收手」（cr-35 改口径；护栏在此夹具下凑不满 3 批）。
    await insertLegacyRow("vfs_content_blob", "bb-stall-v", corpus(81));
    await insertLegacyRow("session_file_cache_blob", "bb-stall-f", corpus(82));
    assert.equal(await pendingCount("vfs_content_blob"), 1);
    assert.equal(await pendingCount("session_file_cache_blob"), 1);

    const probe = wrapConnBlobUpdateNoEffect();
    const result = await runBlobBinaryNormalization(probe.conn);

    assert.equal(result.done, false, "收尾校验收手即未完成");
    assert.equal(
      result.stalled,
      true,
      "必须给出可区分的停机信号：app 层据此停止重试而非零延迟续跑"
    );
    assert.equal(result.normalizedCount, 0, "UPDATE 未生效，一行都没搬走");
    assert.equal(result.failedCount, 0, "零进展不是解码失败");
    assert.equal(
      probe.updateCount(),
      2,
      "本夹具下是收尾谓词校验先收手（护栏凑不满 3 批）：每表 1 行、每行 1 次 UPDATE，共 2 次"
    );

    // 语料原样留在谓词里、且不置完成标记：下个冷启动还会重试。
    assert.equal(await pendingCount("vfs_content_blob"), 1);
    assert.equal(await pendingCount("session_file_cache_blob"), 1);
    const kkv = new SqliteKkvRepository(conn());
    assert.equal(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "vfsContentDone"),
      null,
      "收尾校验收手不得置 vfsContent 标记"
    );
    assert.equal(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "fileCacheDone"),
      null,
      "收尾校验收手不得置 fileCache 标记"
    );
  });

  it("标记短路面：已置完成标记的表不跑 COUNT", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-short-v", corpus(51));
    await insertLegacyRow("session_file_cache_blob", "bb-short-f", corpus(52));
    await setDoneMarker("fileCacheDone");

    // 【cr-15】改用 withSqlProbe（此前手工 patch conn.query + 赋回 bound
    // 函数，会在共享 conn 上留下 own-property 遮蔽原型方法，后续用例拿到
    // 的不是原生实现）；探针恢复一律 delete（见 withSqlProbe 的 finally）。
    const probed = await withSqlProbe(() => getBlobBinaryStatus(conn()));
    const tables = [...probed.result.tables];

    assert.deepEqual(tables, [
      { table: "vfsContent", done: false, pendingCount: 1, failedCount: 0 },
      { table: "fileCache", done: true, pendingCount: 0, failedCount: 0 },
      { table: "messageContent", done: true, pendingCount: 0, failedCount: 0 },
    ]);
    assert.equal(
      probed.seen.filter(
        (sql) =>
          sql.includes("COUNT(*)") && sql.includes("session_file_cache_blob")
      ).length,
      0,
      "已标记表不应下 COUNT"
    );
    assert.ok(
      probed.seen.some((sql) => sql.includes("COUNT(*)") && sql.includes("vfs_content_blob")),
      "未标记表仍走 COUNT"
    );
    // 探针必须干净撤离：共享 conn 上不得残留 own-property 遮蔽原型方法
    //（cr-15 的判据——delete 恢复后拿到的就是原型上的原生实现）。
    assert.equal(
      conn().query,
      (Object.getPrototypeOf(conn()) as TdbcConnection).query,
      "用例后 conn.query 必须还是原型上的原生实现（delete 恢复而非赋回）"
    );
  });

  it("chat_message 适配器：zlib-b64 行转二进制、坏行跳过计数、legacy 明文行不动、独立完成标记", async () => {
    await resetNormalizationState();
    const ctx = getNovelMasterTestContext();
    // 先建 project/session（chat_message 有 session 外键）。
    const project = await ctx.projects.create(`P-bbmsg-${Date.now()}`);
    const session = await ctx.sessions.create(project.id, `S-bbmsg-${Date.now()}`);
    const sessionId = session.id;

    // 一条好的 zlib-b64 存量行（RN 旧版形态：content_blob 存 base64 文本）。
    const plain = corpus(101);
    const compressed = compressZlib(new TextEncoder().encode(plain));
    const b64 = Buffer.from(compressed).toString("base64");
    const goodId = `bb-msg-good-${Date.now()}`;
    await conn().execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, content_encoding, content_blob, created_at_ms, hidden)
       VALUES (?, ?, 1, 'assistant', '', 'zlib-b64', ?, 1, 0)`,
      [goodId, sessionId, b64]
    );
    // 一条坏的 zlib-b64 行（base64 非法，解码必失败）。
    const badId = `bb-msg-bad-${Date.now()}`;
    await conn().execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, content_encoding, content_blob, created_at_ms, hidden)
       VALUES (?, ?, 2, 'assistant', '', 'zlib-b64', ?, 2, 0)`,
      [badId, sessionId, "not-base64!!"]
    );
    // 一条 legacy 明文行（content_encoding IS NULL）——不在本任务谓词内，
    // 由 message-content-compaction 任务负责，本任务不得触碰。
    const legacyId = `bb-msg-legacy-${Date.now()}`;
    const legacyJson = JSON.stringify({ blocks: [{ type: "text", text: "legacy 明文" }] });
    await conn().execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms, hidden)
       VALUES (?, ?, 3, 'user', ?, 3, 0)`,
      [legacyId, sessionId, legacyJson]
    );

    // 捕获 warn（ic-15：坏行告警必须用 blob 列真名 chat_message.content_blob，
    // 不得再产出「列不存在」的误导文案 chat_message.bytes）。
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    let result: Awaited<ReturnType<typeof runBlobBinaryNormalization>>;
    try {
      result = await runBlobBinaryNormalization(conn());
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(result.done, true);
    assert.equal(result.normalizedCount, 1, "只有好的 b64 行被归一");
    assert.equal(result.failedCount, 1, "坏行跳过并计数");
    assert.ok(
      warnings.some((line) => line.includes("chat_message.content_blob")),
      "坏行告警应指向真实列 chat_message.content_blob（ic-15）"
    );
    assert.ok(
      !warnings.some((line) => line.includes("chat_message.bytes")),
      "坏行告警不得引用不存在的列 chat_message.bytes（ic-15）"
    );

    // 好行形态：encoding=zlib、TYPEOF(content_blob)=blob，且读回明文一致。
    const good = await conn().query<{
      content_encoding: string;
      typeOf: string;
    }>(
      `SELECT content_encoding, TYPEOF(content_blob) AS typeOf FROM chat_message WHERE id = ?`,
      [goodId]
    );
    assert.equal(good[0]!.content_encoding, "zlib");
    assert.equal(String(good[0]!.typeOf), "blob");
    const readBack = await conn().query<{ content_blob: SqlValue }>(
      `SELECT content_blob FROM chat_message WHERE id = ?`,
      [goodId]
    );
    const decoded = new TextDecoder().decode(
      decompressZlib(readBack[0]!.content_blob as Uint8Array)
    );
    assert.equal(decoded, plain, "归一后逐字节一致");

    // 坏行原样保留；legacy 明文行一字未动（compaction 的谓词范围）。
    const bad = await conn().query<{
      content_encoding: string;
      content_blob: string;
    }>(
      `SELECT content_encoding, CAST(content_blob AS TEXT) AS content_blob FROM chat_message WHERE id = ?`,
      [badId]
    );
    assert.equal(bad[0]!.content_encoding, "zlib-b64");
    assert.equal(bad[0]!.content_blob, "not-base64!!");
    const legacy = await conn().query<{
      content_json: string;
      content_encoding: string | null;
    }>(
      `SELECT content_json, content_encoding FROM chat_message WHERE id = ?`,
      [legacyId]
    );
    assert.equal(legacy[0]!.content_json, legacyJson, "legacy 明文行不得被触碰");
    assert.equal(legacy[0]!.content_encoding, null);

    // 独立完成标记 + 状态行（含坏行仍置标记：不阻断收敛；failedCount 经
    // 标记 JSON 快照透出，UI 第三态「已完成（N 条需人工处理）」数据源）。
    const kkv = new SqliteKkvRepository(conn());
    const markerValue = await kkv.get(
      BLOB_BINARY_KKV_MODULE,
      "messageContentDone"
    );
    assert.ok(markerValue, "chat_message 完成标记已置");
    const parsedMarker = JSON.parse(markerValue.value) as {
      failedCount: number;
    };
    assert.equal(parsedMarker.failedCount, 1, "标记 JSON 快照含 failedCount");
    const status = await getBlobBinaryStatus(conn());
    const messageStatus = status.tables.find((t) => t.table === "messageContent");
    assert.deepEqual(messageStatus, {
      table: "messageContent",
      done: true,
      pendingCount: 0,
      failedCount: 1,
    });
  });

  it("cr-06：旧版 ISO 字符串标记向后兼容 + 状态查询纯读无副作用", async () => {
    await resetNormalizationState();
    // 手工写旧版纯 ISO 时间戳标记（升级前格式），另一表留空对照。
    await new SqliteKkvRepository(conn()).set(
      BLOB_BINARY_KKV_MODULE,
      "vfsContentDone",
      "2026-09-01T00:00:00.000Z"
    );
    const kkvRowsBefore = await conn().query<{ key: string; value: string }>(
      "SELECT key, value FROM kkv_entry WHERE module = ? ORDER BY key",
      [BLOB_BINARY_KKV_MODULE]
    );

    const status = await getBlobBinaryStatus(conn());
    const vfs = status.tables.find((t) => t.table === "vfsContent");
    assert.deepEqual(vfs, {
      table: "vfsContent",
      done: true,
      pendingCount: 0,
      failedCount: 0,
    }, "旧版 ISO 标记不抛、failedCount 归零");
    const fileCache = status.tables.find((t) => t.table === "fileCache");
    assert.deepEqual(fileCache, {
      table: "fileCache",
      done: true,
      pendingCount: 0,
      failedCount: 0,
    }, "谓词空未置标记 = 等价完成态");

    // 纯读断言：查询前后 kkv_entry 完全一致（不得借查询补写标记）。
    const kkvRowsAfter = await conn().query<{ key: string; value: string }>(
      "SELECT key, value FROM kkv_entry WHERE module = ? ORDER BY key",
      [BLOB_BINARY_KKV_MODULE]
    );
    assert.deepEqual(kkvRowsAfter, kkvRowsBefore, "状态查询必须零写副作用");
  });

  it("cr-08 自检：withSqlProbe 按连接端口全量拦截（conn.execute 也记录）", async () => {
    await resetNormalizationState();
    // 探针必须覆写 conn.execute（cr-08）：实现将来把语句改走 execute 口
    //（合法重构）时，探针不能静默漏记——否则「不下发 UPDATE」类断言失真。
    // 借维护链路自己也在用的无副作用 PRAGMA 当探针语料。
    const probed = await withSqlProbe(async () => {
      await conn().execute("PRAGMA wal_checkpoint(FULL)");
    });
    assert.ok(
      probed.seen.includes("PRAGMA wal_checkpoint(FULL)"),
      "execute 口下发的 SQL 也必须被探针记录"
    );
    assert.equal(
      conn().execute,
      (Object.getPrototypeOf(conn()) as TdbcConnection).execute,
      "探针撤离后 conn.execute 必须还是原型上的原生实现（delete 恢复）"
    );
  });

  it("cr-07：清标记后第二遍 → 零 UPDATE、数据快照不变（谓词幂等的牙齿）", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-idem2-1", corpus(1));
    await insertLegacyRow("vfs_content_blob", "bb-idem2-2", corpus(2));
    await insertLegacyRow("session_file_cache_blob", "bb-idem2-3", corpus(3));
    const first = await runBlobBinaryNormalization(conn());
    assert.equal(first.done, true);
    assert.equal(first.normalizedCount, 3);
    const afterFirst = {
      vfs: await snapshotShapes("vfs_content_blob", "bb-idem2"),
      cache: await snapshotShapes("session_file_cache_blob", "bb-idem2"),
    };

    // DELETE 三张完成标记：强迫第二遍真走谓词扫描路径（标记短路被摘掉）。
    await conn().execute("DELETE FROM kkv_entry WHERE module = ?", [
      BLOB_BINARY_KKV_MODULE,
    ]);

    const counter = maintenanceCounter();
    const second = await withSqlProbe(() =>
      runBlobBinaryNormalization(conn(), counter.hooks)
    );
    assert.equal(second.result.done, true);
    assert.equal(
      second.result.normalizedCount,
      0,
      "谓词对已归一行天然排除（幂等由谓词保证，而非被标记遮蔽）"
    );
    assert.equal(
      second.seen.filter((sql) => isBlobTableUpdate(sql)).length,
      0,
      "已归一的行不得再被改写（清标记后第二遍零 UPDATE）"
    );
    assert.equal(second.seen.filter((sql) => isChatMessageUpdate(sql)).length, 0);
    assert.deepEqual(
      await snapshotShapes("vfs_content_blob", "bb-idem2"),
      afterFirst.vfs,
      "两表数据快照逐字段不变"
    );
    assert.deepEqual(
      await snapshotShapes("session_file_cache_blob", "bb-idem2"),
      afterFirst.cache
    );
    // 验收语义（cr-07）：若把实现改成「忽略标记强制重扫」，本用例**仍绿**
    //（谓词确实幂等）——这正是它有牙齿的判据；反之若把谓词写错导致二次
    // 改写，本用例变红。另：本轮零行改写 ⇒ processedAny=false ⇒ 不进维护段
    //（maintCalls 语义见 maintenanceCounter：进入收尾维护段的次数）。
    assert.equal(counter.maintCalls(), 0, "零改写不得触发收尾维护（cr-01）");
  });

  it("cr-09：空库（无行、标记皆无）→ 状态查询纯读回报三表 done", async () => {
    await resetNormalizationState();
    const status = await getBlobBinaryStatus(conn());
    assert.deepEqual(status.tables, [
      { table: "vfsContent", done: true, pendingCount: 0, failedCount: 0 },
      { table: "fileCache", done: true, pendingCount: 0, failedCount: 0 },
      { table: "messageContent", done: true, pendingCount: 0, failedCount: 0 },
    ]);
  });

  it("cr-09：全新内存库直跑 → 全零返回且三表标记置上（空库首启由任务侧置标记）", async () => {
    // 独立于共享库的全新 :memory: 连接（三表全空、标记皆无）。
    const fresh = await openNovelMasterTestConnection();
    try {
      const counter = maintenanceCounter();
      const result = await runBlobBinaryNormalization(fresh.conn, counter.hooks);
      assert.deepEqual(result, {
        done: true,
        normalizedCount: 0,
        failedCount: 0,
        stalled: false,
      });
      const kkv = new SqliteKkvRepository(fresh.conn);
      for (const key of [
        "vfsContentDone",
        "fileCacheDone",
        "messageContentDone",
      ]) {
        assert.ok(await kkv.get(BLOB_BINARY_KKV_MODULE, key), `${key} 应被置上`);
      }
      // maintCalls 语义（cr-31）：进入收尾维护段的次数（含被去重短路的
      // 调用），不代表 VACUUM 真跑。零改写 + 无 pending ⇒ 门条件不满足。
      assert.equal(counter.maintCalls(), 0, "空库零改写不进维护段");
    } finally {
      await fresh.conn.close();
    }
  });

  it("cr-10：vfsContent 已置标记、fileCache 待归一 → 执行侧互不牵连", async () => {
    await resetNormalizationState();
    await insertLegacyRow("session_file_cache_blob", "bb-mix-f", corpus(131));
    await setDoneMarker("vfsContentDone");

    const counter = maintenanceCounter();
    const probed = await withSqlProbe(() =>
      runBlobBinaryNormalization(conn(), counter.hooks)
    );
    assert.equal(probed.result.done, true);
    assert.equal(probed.result.normalizedCount, 1, "只有 fileCache 的 1 行被归一");

    // fileCache 行已归一：encoding=zlib / TYPEOF=blob / byte_len=物理长度。
    const rows = await conn().query<{
      encoding: string;
      typeOf: string;
      byte_len: number;
      physical: number;
    }>(
      `SELECT encoding, TYPEOF(bytes) AS typeOf, byte_len, LENGTH(bytes) AS physical
       FROM session_file_cache_blob WHERE content_hash = 'bb-mix-f'`
    );
    assert.equal(rows[0]!.encoding, "zlib");
    assert.equal(String(rows[0]!.typeOf), "blob");
    assert.equal(Number(rows[0]!.byte_len), Number(rows[0]!.physical));

    const kkv = new SqliteKkvRepository(conn());
    assert.ok(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "fileCacheDone"),
      "fileCache 完成标记已置"
    );
    assert.ok(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "messageContentDone"),
      "messageContent（空表）标记照置，三表互不牵连（ic-36b）"
    );
    assert.equal(
      probed.seen.filter((sql) => /^\s*UPDATE\s+vfs_content_blob\b/i.test(sql))
        .length,
      0,
      "已置标记的 vfs_content_blob 整轮零 UPDATE"
    );
    assert.equal(probed.seen.filter((sql) => isChatMessageUpdate(sql)).length, 0);
    // 验收语义（cr-10）：若把三表完成标记合并成一个共享 key，本用例应变红
    //（fileCache 的行会因 vfsContentDone 短路而永不被归一）。
    // maintCalls 语义（cr-31）：本轮 1 行改写 ⇒ processedAny ⇒ 进维护段一次。
    assert.equal(counter.maintCalls(), 1);
  });

  it("cr-01 稳态：三表完成标记已置 → 零归一、零 UPDATE、不进收尾维护段", async () => {
    await resetNormalizationState();
    for (const key of [
      "vfsContentDone",
      "fileCacheDone",
      "messageContentDone",
    ]) {
      await setDoneMarker(key);
    }
    const counter = maintenanceCounter();
    const probed = await withSqlProbe(() =>
      runBlobBinaryNormalization(conn(), counter.hooks)
    );
    // maintCalls 语义（cr-31）：进入收尾维护段的次数（含被去重短路的
    // 调用），不代表 VACUUM 真跑。稳态零行改写 → 不释放 freelist 页 →
    // 门条件不满足 → 不进维护段。反向说明：把 cr-01 门条件整段短路成
    // if (false) 后本用例**不会**变红——它的判据是「不进入」；钉「进入」
    // 的是「首轮确有归一」用例，两者合起来才是门条件的完整覆盖。
    assert.equal(counter.maintCalls(), 0);
    assert.deepEqual(probed.result, {
      done: true,
      normalizedCount: 0,
      failedCount: 0,
      stalled: false,
    });
    assert.equal(probed.seen.filter((sql) => isBlobTableUpdate(sql)).length, 0);
    assert.equal(probed.seen.filter((sql) => isChatMessageUpdate(sql)).length, 0);
  });

  it("cr-01 空库首启（标记皆无、谓词空）→ 置标记但不进收尾维护段", async () => {
    await resetNormalizationState();
    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn(), counter.hooks);
    // 无页可归还，不跑维护是正确行为（maintCalls 语义见 maintenanceCounter）。
    assert.equal(counter.maintCalls(), 0);
    assert.deepEqual(result, {
      done: true,
      normalizedCount: 0,
      failedCount: 0,
      stalled: false,
    });
    // 标记由任务侧本轮置上（状态查询保持纯读，见 cr-28/cr-06 兼容用例）。
    const kkv = new SqliteKkvRepository(conn());
    for (const key of [
      "vfsContentDone",
      "fileCacheDone",
      "messageContentDone",
    ]) {
      assert.ok(await kkv.get(BLOB_BINARY_KKV_MODULE, key), `${key} 应被置上`);
    }
  });

  it("cr-01 首轮确有归一 → 进入一次收尾维护段", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-first-run", corpus(111));
    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn(), counter.hooks);
    assert.equal(result.normalizedCount, 1, "1 行 legacy 被归一");
    // maintCalls 语义（cr-31）：进入收尾维护段的次数（含被去重短路的
    // 调用），不代表 VACUUM 真跑——本文件第一条用例已消费进程级去重标记，
    // 本轮 runStartupMaintenanceOnce 返回 null，但维护段确实被进入了。
    // 反向判据（cr-31 A）：把门条件 if (allDone && (processedAny || …))
    // 短路成 if (false)，本断言立刻变红——门条件真的被测住的是这里。
    assert.equal(counter.maintCalls(), 1, "本轮确有推进 ⇒ 进一次收尾维护段");
    assert.equal(result.done, true);
  });

  it("cr-02/cr-24 (a) 纯坏行表（0 正常行）→ 照常置标记、不进收尾维护段", async () => {
    await resetNormalizationState();
    for (let i = 0; i < 100; i++) {
      await insertCorruptRow(`bad-${String(i).padStart(4, "0")}`);
    }
    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn(), counter.hooks);
    assert.equal(result.normalizedCount, 0, "坏行零归一");
    assert.equal(result.failedCount, 100, "坏行全部计数");
    assert.equal(result.done, true, "坏行不阻断完成态");
    assert.equal(result.stalled, false);
    // 坏行原样留在谓词里（100 行，id 排序整体扫完 → leftover === failedKeys
    // → 收尾谓词校验放行置标记）。
    assert.equal(await pendingCount("vfs_content_blob"), 100);
    const kkv = new SqliteKkvRepository(conn());
    const marker = await kkv.get(BLOB_BINARY_KKV_MODULE, "vfsContentDone");
    assert.ok(marker, "纯坏行表也置完成标记");
    assert.equal(
      (JSON.parse(marker.value) as { failedCount: number }).failedCount,
      100,
      "标记 JSON 快照含 failedCount=100"
    );
    assert.ok(await kkv.get(BLOB_BINARY_KKV_MODULE, "fileCacheDone"));
    assert.ok(await kkv.get(BLOB_BINARY_KKV_MODULE, "messageContentDone"));
    // 按 cr-25 收敛：零行被改写 → 不释放 freelist 页 → 不触发收尾维护
    //（maintCalls 语义见 maintenanceCounter）。反向判据（cr-31 C）：把
    // (done && failedCount > 0) 那一支补回门条件，本用例即变红
    //（maintCalls 变 1）——这是门条件真的被钉住的证据。
    assert.equal(counter.maintCalls(), 0);
  });

  it("cr-02/cr-24 (b) 坏行满批 + 尾部正常行（100 坏 + 20 好）→ 20 行全部归一", async () => {
    await resetNormalizationState();
    for (let i = 0; i < 100; i++) {
      await insertCorruptRow(`bad-${String(i).padStart(4, "0")}`);
    }
    for (let i = 100; i < 120; i++) {
      await insertLegacyRow(
        "vfs_content_blob",
        `good-${String(i).padStart(4, "0")}`,
        corpus(i)
      );
    }
    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn(), counter.hooks);
    assert.equal(result.normalizedCount, 20, "尾部 20 行正常行全部归一");
    assert.equal(result.failedCount, 100);
    assert.equal(result.done, true);
    assert.equal(result.stalled, false);

    // 20 行形态：encoding=zlib / TYPEOF=blob / byte_len = LENGTH(bytes)。
    const rows = await conn().query<{
      encoding: string;
      typeOf: string;
      byte_len: number;
      physical: number;
    }>(
      `SELECT encoding, TYPEOF(bytes) AS typeOf, byte_len, LENGTH(bytes) AS physical
       FROM vfs_content_blob WHERE content_hash LIKE 'good-%'`
    );
    assert.equal(rows.length, 20);
    for (const row of rows) {
      assert.equal(row.encoding, "zlib");
      assert.equal(String(row.typeOf), "blob");
      assert.equal(Number(row.byte_len), Number(row.physical));
    }
    assert.ok(
      await new SqliteKkvRepository(conn()).get(
        BLOB_BINARY_KKV_MODULE,
        "vfsContentDone"
      ),
      "标记已置"
    );
    // 与 (a) 的差别只在有没有正常行：(a) 零改写 → 零维护；(b) 改写了
    // 20 行 → 进一次维护段（maintCalls 语义见 maintenanceCounter）。
    // 反向判据（cr-35）：把 allKnownFailed 分支改回 break，本用例变红
    //（第一批 100 坏行即整表收尾，20 行正常行一条都不归一）。
    assert.equal(counter.maintCalls(), 1);
  });

  it("cr-02/ic-36a chat_message 前 100 条 id 全坏：尾部正常行仍被归一", async () => {
    await resetNormalizationState();
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-bbmsg2-${Date.now()}`);
    const session = await ctx.sessions.create(project.id, `S-bbmsg2-${Date.now()}`);
    const sessionId = session.id;
    const pad = (i: number) => String(i).padStart(4, "0");

    // 100 条坏行（id 前缀 a- 排序在前）+ 5 条正常行（前缀 b- 排在后），
    // 夹具统一 bb-msg- 前缀（ic-27 口径）。
    for (let i = 0; i < 100; i++) {
      await conn().execute(
        `INSERT INTO chat_message (id, session_id, seq, role, content_json, content_encoding, content_blob, created_at_ms, hidden)
         VALUES (?, ?, ?, 'assistant', '', 'zlib-b64', 'not-base64!!', 0, 0)`,
        [`bb-msg-a-bad-${pad(i)}`, sessionId, i + 1]
      );
    }
    const goodIds: Array<{ id: string; plain: string }> = [];
    for (let i = 0; i < 5; i++) {
      const id = `bb-msg-b-good-${pad(i)}`;
      const plain = corpus(200 + i);
      const b64 = Buffer.from(
        compressZlib(new TextEncoder().encode(plain))
      ).toString("base64");
      await conn().execute(
        `INSERT INTO chat_message (id, session_id, seq, role, content_json, content_encoding, content_blob, created_at_ms, hidden)
         VALUES (?, ?, ?, 'assistant', '', 'zlib-b64', ?, 0, 0)`,
        [id, sessionId, 1000 + i, b64]
      );
      goodIds.push({ id, plain });
    }

    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn(), counter.hooks);
    assert.equal(result.normalizedCount, 5, "尾部正常行全部被归一");
    assert.equal(result.failedCount, 100, "坏行跳过并计数");
    assert.equal(result.done, true);
    assert.equal(result.stalled, false);

    // 好行形态 + 逐字节读回。
    for (const good of goodIds) {
      const rows = await conn().query<{
        content_encoding: string;
        typeOf: string;
      }>(
        `SELECT content_encoding, TYPEOF(content_blob) AS typeOf FROM chat_message WHERE id = ?`,
        [good.id]
      );
      assert.equal(rows[0]!.content_encoding, "zlib");
      assert.equal(String(rows[0]!.typeOf), "blob");
      const blobRows = await conn().query<{ content_blob: SqlValue }>(
        `SELECT content_blob FROM chat_message WHERE id = ?`,
        [good.id]
      );
      assert.equal(
        new TextDecoder().decode(
          decompressZlib(blobRows[0]!.content_blob as Uint8Array)
        ),
        good.plain,
        "归一后逐字节一致"
      );
    }
    const marker = await new SqliteKkvRepository(conn()).get(
      BLOB_BINARY_KKV_MODULE,
      "messageContentDone"
    );
    assert.ok(marker, "chat_message 完成标记已置");
    assert.equal(
      (JSON.parse(marker.value) as { failedCount: number }).failedCount,
      100,
      "标记快照 failedCount=100"
    );
    // 5 行改写 ⇒ 进维护段（maintCalls 语义见 maintenanceCounter）。
    assert.equal(counter.maintCalls(), 1);
  });

  it("cr-02/cr-24 反例：1 正常行 + 1 打转行 → 收尾谓词校验拦住、该表标记未置", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-spin-good", corpus(121));
    await insertLegacyRow("vfs_content_blob", "bb-spin-stuck", corpus(122));
    // 只让 bb-spin-stuck 的 UPDATE 恒 changes=0（打转：驱动把二进制绑回
    // TEXT、谓词更新后仍命中）；bb-spin-good 正常执行。
    const probe = wrapConnBlobUpdateNoEffect(["bb-spin-stuck"]);
    const result = await runBlobBinaryNormalization(probe.conn);

    assert.equal(result.done, false, "收尾校验判残留即未完成");
    assert.equal(
      result.stalled,
      true,
      "收尾谓词校验判定残留非坏行（leftover 1 > failedKeys 0）"
    );
    // 该表标记未置：round 1 的纯游标化方案（无收尾校验）会在本用例下
    // 误置完成标记、打转行被静默宣布完成。
    assert.equal(
      await new SqliteKkvRepository(conn()).get(
        BLOB_BINARY_KKV_MODULE,
        "vfsContentDone"
      ),
      null,
      "打转行未收敛，不得置完成标记"
    );
    // 正常行已被归一（打转不阻断同批其它行）；打转行原样留在谓词里。
    assert.equal(
      await readPlain("vfs_content_blob", "bb-spin-good"),
      corpus(121),
      "同批正常行照常归一"
    );
    assert.equal(await pendingCount("vfs_content_blob"), 1, "谓词里只剩打转行");
  });

  it("cr-32 同进程二次调用：pending 保留待下次冷启动、不被误清", async () => {
    await resetNormalizationState();
    await new SqliteKkvRepository(conn()).set(
      BLOB_BINARY_KKV_MODULE,
      "startupMaintenancePending",
      "1"
    );
    // 让进程级标记落位（本文件第一条用例已消费过它，此处恒返回 null；
    // 单跑本用例时它会真跑一次维护——两种情况下标记都必然已置）。
    await runStartupMaintenanceOnce(conn());

    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn(), counter.hooks);
    // maintCalls === 1（cr-31 r4 口径）：入口读到 pending 强制走维护段——
    // beforeMaintenance 早于 runStartupMaintenanceOnce 的调用点（app 层借
    // 它先置 busy），进程级去重短路发生在后者**内部**、不影响维护段被
    // 进入。maintCalls = 进入收尾维护段的次数（含被去重短路的调用），
    // 不代表 VACUUM 真跑。
    assert.equal(counter.maintCalls(), 1);
    assert.equal(result.done, true);
    // 本用例的判据落点是「标记是否被误清」（不是维护段计数）：
    // runStartupMaintenanceOnce 返回 null ⇒ 条件式清标记不执行 ⇒ 兜底
    // 留待下次冷启动。反向判据（cr-31 B）：把清标记改回「无条件清」，
    // 本用例必须变红（此处会读到 null）。
    assert.ok(
      await new SqliteKkvRepository(conn()).get(
        BLOB_BINARY_KKV_MODULE,
        "startupMaintenancePending"
      ),
      "startupMaintenancePending 仍在 kkv_entry、未被误清"
    );
  });

  it("ic-12：标记值损坏（负数/小数）不透传，非负整数正常透出", async () => {
    await resetNormalizationState();
    const kkv = new SqliteKkvRepository(conn());
    await kkv.set(
      BLOB_BINARY_KKV_MODULE,
      "vfsContentDone",
      JSON.stringify({ at: new Date().toISOString(), failedCount: -3 })
    );
    await kkv.set(
      BLOB_BINARY_KKV_MODULE,
      "fileCacheDone",
      JSON.stringify({ at: new Date().toISOString(), failedCount: 1.5 })
    );
    await kkv.set(
      BLOB_BINARY_KKV_MODULE,
      "messageContentDone",
      JSON.stringify({ at: new Date().toISOString(), failedCount: 5 })
    );
    const status = await getBlobBinaryStatus(conn());
    const byTable = new Map(status.tables.map((t) => [t.table, t]));
    assert.deepEqual(byTable.get("vfsContent"), {
      table: "vfsContent",
      done: true,
      pendingCount: 0,
      failedCount: 0,
    }, "负数归 0（透传会渲染出「已完成（-3 条需人工处理）」）");
    assert.deepEqual(byTable.get("fileCache"), {
      table: "fileCache",
      done: true,
      pendingCount: 0,
      failedCount: 0,
    }, "小数归 0");
    assert.deepEqual(byTable.get("messageContent"), {
      table: "messageContent",
      done: true,
      pendingCount: 0,
      failedCount: 5,
    }, "非负整数正常透出");
  });
});
