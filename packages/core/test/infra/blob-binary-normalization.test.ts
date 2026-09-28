/**
 * 存量 blob 行形态归一任务用例（T-BB4 ~ T-BB7 + 标记短路面 + chat_message
 * 适配器）。
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
 * base64 文本在测试内用 `Buffer` 现场编码，不引 blob-bytes-codec 的
 * `bytesToBase64`（A1 已删该导出，生产端无调用方）。
 *
 * @module test/infra/blob-binary-normalization
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  type BlobBinaryTableStatus,
} from "../../src/infra/db-maintenance/index.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

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

/** 谓词命中行清零 + 完成标记清零（用例自管状态的地基）。 */
async function resetNormalizationState(): Promise<void> {
  const c = conn();
  await c.execute(`DELETE FROM vfs_content_blob WHERE ${PREDICATE}`);
  await c.execute(`DELETE FROM session_file_cache_blob WHERE ${PREDICATE}`);
  await c.execute(`DELETE FROM chat_message WHERE ${MESSAGE_PREDICATE}`);
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

/** 探针覆写的连接成员（只覆 `query` / `transaction`，其余不动）。 */
type ProbedConn = {
  query: TdbcConnection["query"];
  transaction: TdbcConnection["transaction"];
};

/** 探针覆写的 tx 成员（只覆 `execute`）。 */
type ProbedTx = {
  execute: TdbcConnection["execute"];
};

/**
 * 包一层 SQL 探针：记录本轮实际下发给连接（含事务内 `tx`）的 SQL。
 *
 * @remarks 归一任务只用到 `conn.query` / `conn.transaction` / `tx.execute`
 * 三个口，探针即按这三个口最小实现；用完在 `finally` 里还原（共享连接不能
 * 带伤往下传给后续用例）。
 */
async function withSqlProbe<T>(
  fn: () => Promise<T>
): Promise<{ result: T; seen: string[] }> {
  const c = conn();
  const seen: string[] = [];
  const originalQuery = c.query;
  const originalTransaction = c.transaction;
  const probe = c as unknown as ProbedConn;
  probe.query = ((sql: string, parameters?: readonly unknown[]) => {
    seen.push(sql);
    return originalQuery.call(c, sql, parameters);
  }) as TdbcConnection["query"];
  probe.transaction = (<T>(inner: (tx: TdbcConnection) => Promise<T>) =>
    originalTransaction.call(c, async (tx) => {
      const originalExecute = tx.execute;
      const txProbe = tx as unknown as ProbedTx;
      txProbe.execute = ((sql: string, parameters?: readonly unknown[]) => {
        seen.push(sql);
        return originalExecute.call(tx, sql, parameters);
      }) as TdbcConnection["execute"];
      try {
        return await inner(tx);
      } finally {
        txProbe.execute = originalExecute;
      }
    })) as TdbcConnection["transaction"];
  try {
    return { result: await fn(), seen };
  } finally {
    probe.query = originalQuery;
    probe.transaction = originalTransaction;
  }
}

/** 两张 blob 表的 UPDATE 识别（探针与零进展替身共用同一口径）。 */
function isBlobTableUpdate(sql: string): boolean {
  return /^\s*UPDATE\s+(?:vfs_content_blob|session_file_cache_blob)\b/i.test(sql);
}

/**
 * 让两张 blob 表的 UPDATE 恒返回 `changes = 0` 的连接替身。
 *
 * 模拟「写回不生效」——典型是某端驱动把二进制值绑成 TEXT 存回，谓词下一轮
 * 仍反复命中同一批行。UPDATE **不真正执行**（直接短路返回），行原样留在
 * 谓词里，零进展护栏的输入就此造好。
 *
 * @remarks 归一任务只用到 `conn.query` / `conn.transaction` / `conn.execute`，
 * 替身按这三个口最小实现，**不改生产代码结构**；非 blob 表的语句照常转发
 * 给真实事务，KKV 完成标记的写入仍能落库——这样断言的才是「护栏收手故未
 * 置标记」，而不是「写不进去」。
 */
function wrapConnBlobUpdateNoEffect(): {
  readonly conn: TdbcConnection;
  /** 被短路的 blob 表 UPDATE 次数（每表一轮批 = 1 次）。 */
  readonly updateCount: () => number;
} {
  const c = conn();
  let updates = 0;
  const wrapTx = (realTx: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      if (isBlobTableUpdate(sql)) {
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
   * 收尾维护链路抛错（磁盘满 / 库被锁时的 VACUUM 失败）只 warn、不上抛。
   *
   * @remarks **必须声明为本文件第一条用例**：`runStartupMaintenanceOnce` 是
   * 模块级进程去重，本进程内首个调用者才会真跑维护链路。若前面已有用例跑过
   * 归一并置了去重标记，这条用例就短路成「什么都没跑」，断言会失去意义。
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

    // 第二遍：完成标记已置 → 零归一、**不下发任何 blob 表 UPDATE**、
    // 数据逐字段未变。探针覆盖连接口与事务内 tx 两个下发路径。
    const second = await withSqlProbe(() => runBlobBinaryNormalization(conn()));
    assert.equal(second.result.done, true);
    assert.equal(second.result.stalled, false);
    assert.equal(second.result.normalizedCount, 0, "第二遍零归一");
    assert.deepEqual(
      second.seen.filter((sql) => isBlobTableUpdate(sql)),
      [],
      "标记已置后不得再下发 vfs_content_blob / session_file_cache_blob 的 UPDATE"
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

  it("零进展护栏：UPDATE 恒 changes=0 时 3 批内 stalled=true、零归一、两表标记均未置", async () => {
    await resetNormalizationState();
    // 每表只放 1 行（< BATCH_SIZE）：旧口径的「满批」条件在这种卡住行数下
    // 永远不会触发护栏，正是本用例要回归的漏洞（卡住的行数恰恰通常不满批）。
    await insertLegacyRow("vfs_content_blob", "bb-stall-v", corpus(81));
    await insertLegacyRow("session_file_cache_blob", "bb-stall-f", corpus(82));
    assert.equal(await pendingCount("vfs_content_blob"), 1);
    assert.equal(await pendingCount("session_file_cache_blob"), 1);

    const probe = wrapConnBlobUpdateNoEffect();
    const result = await runBlobBinaryNormalization(probe.conn);

    assert.equal(result.done, false, "护栏收手即未完成");
    assert.equal(
      result.stalled,
      true,
      "必须给出可区分的停机信号：app 层据此停止重试而非零延迟续跑"
    );
    assert.equal(result.normalizedCount, 0, "UPDATE 未生效，一行都没搬走");
    assert.equal(result.failedCount, 0, "零进展不是解码失败");
    assert.equal(
      probe.updateCount(),
      6,
      "每表 3 批即收手（护栏阈值 3，不做无界空转）"
    );

    // 语料原样留在谓词里、且不置完成标记：下个冷启动还会重试。
    assert.equal(await pendingCount("vfs_content_blob"), 1);
    assert.equal(await pendingCount("session_file_cache_blob"), 1);
    const kkv = new SqliteKkvRepository(conn());
    assert.equal(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "vfsContentDone"),
      null,
      "护栏收手不得置 vfsContent 标记"
    );
    assert.equal(
      await kkv.get(BLOB_BINARY_KKV_MODULE, "fileCacheDone"),
      null,
      "护栏收手不得置 fileCache 标记"
    );
  });

  it("标记短路面：已置完成标记的表不跑 COUNT", async () => {
    await resetNormalizationState();
    await insertLegacyRow("vfs_content_blob", "bb-short-v", corpus(51));
    await insertLegacyRow("session_file_cache_blob", "bb-short-f", corpus(52));
    await setDoneMarker("fileCacheDone");

    // 包裹 conn.query 记录实际下发的 SQL：file_cache 表已标记，应零 COUNT。
    const c = conn();
    const original = c.query.bind(c);
    const seen: string[] = [];
    (c as unknown as { query: (sql: string, p?: readonly unknown[]) => Promise<unknown[]> }).query =
      (sql: string, p?: readonly unknown[]) => {
        seen.push(sql);
        return original(sql, p);
      };
    let tables: BlobBinaryTableStatus[] = [];
    try {
      tables = [...(await getBlobBinaryStatus(c)).tables];
    } finally {
      (c as unknown as { query: typeof original }).query = original;
    }

    assert.deepEqual(tables, [
      { table: "vfsContent", done: false, pendingCount: 1, failedCount: 0 },
      { table: "fileCache", done: true, pendingCount: 0, failedCount: 0 },
      { table: "messageContent", done: true, pendingCount: 0, failedCount: 0 },
    ]);
    assert.equal(
      seen.filter(
        (sql) =>
          sql.includes("COUNT(*)") && sql.includes("session_file_cache_blob")
      ).length,
      0,
      "已标记表不应下 COUNT"
    );
    assert.ok(
      seen.some((sql) => sql.includes("COUNT(*)") && sql.includes("vfs_content_blob")),
      "未标记表仍走 COUNT"
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

    const result = await runBlobBinaryNormalization(conn());
    assert.equal(result.done, true);
    assert.equal(result.normalizedCount, 1, "只有好的 b64 行被归一");
    assert.equal(result.failedCount, 1, "坏行跳过并计数");

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
});
