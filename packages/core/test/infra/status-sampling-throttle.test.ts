/**
 * 状态采样 COUNT 路径节流验收（ic-06①）。
 *
 * getMessageCompactionStatus / getBlobBinaryStatus 的谓词 COUNT 路径带
 * 3s 模块级节流（按连接实例隔离的 WeakMap 缓存）：窗口内重复调用回放
 * 上次采样值。只有真触 COUNT 的未完成态采样才写缓存——标记已置的免
 * COUNT 快路径不进节流域（既有文件 T-C7 / 标记短路面用例已覆盖，此处
 * 不重复）。**2s 轮询 + 全表扫 = 迁移期 IO 风暴，节流窗口取 3s**。
 *
 * 时序口径：10 次调用为同步连调（无人为 sleep），天然在 3s 窗口内完成
 * ——断言 COUNT 下发 ≤2 次；reset 钩子（__resetStatusSamplingThrottle
 * ForTests）清缓存后首次调用重新下发。独立新文件承载（node test runner
 * 每文件一进程），避免与 message-content-compaction.test.ts /
 * blob-binary-normalization.test.ts 的进程级顺序约束互相牵连。
 *
 * @module test/infra/status-sampling-throttle
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { compressZlib } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import {
  BLOB_BINARY_KKV_MODULE,
  MESSAGE_COMPACTION_KKV_KEY,
  MESSAGE_COMPACTION_KKV_MODULE,
  getBlobBinaryStatus,
  getMessageCompactionStatus,
} from "../../src/infra/db-maintenance/index.js";
import {
  MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY,
  __resetStatusSamplingThrottleForTests as resetCompactionThrottle,
} from "../../src/infra/db-maintenance/impl/message-content-compaction.js";
import { __resetStatusSamplingThrottleForTests as resetBlobThrottle } from "../../src/infra/db-maintenance/impl/blob-binary-normalization.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 归一谓词（与实现同形，测试侧清理夹具用）。 */
const PREDICATE = `(encoding = 'zlib-b64' OR (encoding = 'zlib' AND TYPEOF(bytes) = 'text'))`;

/** chat_message 侧同形谓词（列名不同）。 */
const MESSAGE_PREDICATE = `(content_encoding = 'zlib-b64' OR (content_encoding = 'zlib' AND TYPEOF(content_blob) = 'text'))`;

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

/** COUNT 语句识别（readDoneMarker 的 kkv SELECT 不含 COUNT(*)，不误计）。 */
const isCountStar = (sql: string): boolean => /SELECT\s+COUNT\(\*\)/i.test(sql);

/** 探针覆写的连接成员（覆 `query` / `execute` / `transaction`，其余不动）。 */
type ProbedConn = {
  query: TdbcConnection["query"];
  execute: TdbcConnection["execute"];
  transaction: TdbcConnection["transaction"];
};

/**
 * 包一层 SQL 探针：记录本轮实际下发给连接的 SQL。
 *
 * @remarks delete 版恢复（blob-binary-normalization.test.ts 的 cr-15 口径）：
 * 共享连接不能带伤往下传，finally 里用 delete 撤 own-property，原型上的
 * 原生实现重新可见。
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
    originalTransaction.call(c, inner)) as TdbcConnection["transaction"];
  try {
    return { result: await fn(), seen };
  } finally {
    delete (probe as Partial<ProbedConn>).query;
    delete (probe as Partial<ProbedConn>).execute;
    delete (probe as Partial<ProbedConn>).transaction;
  }
}

describe("getMessageCompactionStatus 的谓词 COUNT 节流（ic-06①）", () => {
  it("标记未置 + 有待压缩行：3s 窗口内连调 10 次，COUNT 下发 ≤2；reset 后首次调用重新下发", async () => {
    resetCompactionThrottle();
    resetBlobThrottle();
    const c = conn();

    // 夹具：清 compaction 完成标记 + pending 兜底标记 + 全表明文行，
    // 再插 1 条明文行（pendingCount 精确为 1）。
    await c.execute(
      "DELETE FROM kkv_entry WHERE module = ? AND key IN (?, ?)",
      [
        MESSAGE_COMPACTION_KKV_MODULE,
        MESSAGE_COMPACTION_KKV_KEY,
        MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY,
      ]
    );
    await c.execute("DELETE FROM chat_message WHERE content_json != ''");
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );
    await c.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, created_at_ms, hidden
       ) VALUES (?, ?, 1, 'user', ?, ?, 0)`,
      [
        randomUUID(),
        session.id,
        JSON.stringify(textBlocks("节流验证明文行")),
        Date.now(),
      ]
    );

    // 同步连调 10 次（无人为 sleep，天然在 3s 窗口内完成，不跨窗）。
    const statuses: Awaited<ReturnType<typeof getMessageCompactionStatus>>[] = [];
    const { seen } = await withSqlProbe(async () => {
      for (let i = 0; i < 10; i++) {
        statuses.push(await getMessageCompactionStatus(c));
      }
    });

    const countSqls = seen.filter(isCountStar);
    assert.ok(
      countSqls.length >= 1,
      "首轮采样应真下发 COUNT（对照：证明探针有牙，防恒真）"
    );
    assert.ok(
      countSqls.length <= 2,
      `3s 窗口内 10 次连调的 COUNT 下发应 ≤2 次，实际 ${countSqls.length}`
    );
    for (const [i, status] of statuses.entries()) {
      assert.deepEqual(
        status,
        { done: false, pendingCount: 1 },
        `第 ${i + 1} 次返回值应与首轮一致（窗口内回放上次采样值）`
      );
    }

    // reset 钩子清缓存后：首次调用重新下发 COUNT（拿到的是新采样值）。
    resetCompactionThrottle();
    const afterReset = await withSqlProbe(() => getMessageCompactionStatus(c));
    assert.deepEqual(afterReset.result, { done: false, pendingCount: 1 });
    assert.ok(
      afterReset.seen.some(isCountStar),
      "reset 后首次调用应重新下发 COUNT"
    );
  });
});

describe("getBlobBinaryStatus 的谓词 COUNT 节流（ic-06①）", () => {
  it("标记未置 + 有待归一行：3s 窗口内连调 10 次，每表 COUNT 下发 ≤2；reset 后首次调用重新下发", async () => {
    resetCompactionThrottle();
    resetBlobThrottle();
    const c = conn();

    // 夹具：三表谓词命中行清零 + nm-blob-binary 标记清零，vfs 插 1 条
    // legacy base64 行（pendingCount 精确为 1；另两表谓词空、标记未置）。
    await c.execute(`DELETE FROM vfs_content_blob WHERE ${PREDICATE}`);
    await c.execute(`DELETE FROM session_file_cache_blob WHERE ${PREDICATE}`);
    await c.execute(
      `DELETE FROM chat_message WHERE ${MESSAGE_PREDICATE}`
    );
    await c.execute("DELETE FROM kkv_entry WHERE module = ?", [
      BLOB_BINARY_KKV_MODULE,
    ]);
    const compressed = compressZlib(
      new TextEncoder().encode("节流验证语料")
    );
    await c.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES (?, 'zlib-b64', ?, ?, 0)`,
      [
        "throttle-hash-1",
        Buffer.from(compressed).toString("base64"),
        compressed.byteLength,
      ]
    );

    const statuses: Awaited<ReturnType<typeof getBlobBinaryStatus>>[] = [];
    const { seen } = await withSqlProbe(async () => {
      for (let i = 0; i < 10; i++) {
        statuses.push(await getBlobBinaryStatus(c));
      }
    });

    // 每张表的谓词 COUNT 在 10 次连调内至多 2 轮（实际 1 轮 = 每表 1 条）；
    // vfs 表另断言 ≥1（防恒真：证明首轮真采样被探针观测到）。
    for (const table of [
      "vfs_content_blob",
      "session_file_cache_blob",
      "chat_message",
    ]) {
      const tableCounts = seen.filter(
        (sql) => isCountStar(sql) && sql.includes(table)
      );
      assert.ok(
        tableCounts.length <= 2,
        `3s 窗口内 10 次连调的 ${table} COUNT 下发应 ≤2 次，实际 ${tableCounts.length}`
      );
    }
    assert.ok(
      seen.some((sql) => isCountStar(sql) && sql.includes("vfs_content_blob")),
      "首轮采样应真下发 vfs_content_blob 的 COUNT（防恒真）"
    );
    for (const [i, status] of statuses.entries()) {
      assert.deepEqual(
        status.tables,
        [
          { table: "vfsContent", done: false, pendingCount: 1, failedCount: 0 },
          { table: "fileCache", done: true, pendingCount: 0, failedCount: 0 },
          { table: "messageContent", done: true, pendingCount: 0, failedCount: 0 },
        ],
        `第 ${i + 1} 次返回值应与首轮一致（窗口内回放上次采样值）`
      );
    }

    // reset 钩子清缓存后：首次调用重新下发 COUNT。
    resetBlobThrottle();
    const afterReset = await withSqlProbe(() => getBlobBinaryStatus(c));
    assert.equal(afterReset.result.tables[0]!.pendingCount, 1);
    assert.ok(
      afterReset.seen.some(
        (sql) => isCountStar(sql) && sql.includes("vfs_content_blob")
      ),
      "reset 后首次调用应重新下发 vfs_content_blob 的 COUNT"
    );
  });
});
