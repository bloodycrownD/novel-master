/**
 * 收尾维护进程级去重验收（ic-01①）——独立成文件的原因：`runStartupMaintenanceOnce`
 * 是模块级进程去重，本用例要求进程级标记初始未被消费（本文件是独立测试
 * 进程 + 独立内存库），主测试文件 message-content-compaction.test.ts 的
 * 用例已各自消费标记，不能在其前重跑维护链路（对齐 A1 线 NF-1 纪律）。
 *
 * 判据：同进程先 `runMessageContentCompaction` 再 `runBlobBinaryNormalization`
 * → 全库真跑的 VACUUM 恰 1 次（探针统计 VACUUM 语句下发，**必须覆写
 * `conn.execute` 口**——VACUUM 与 wal_checkpoint 都走该口，只覆 query /
 * tx.execute 会静默漏观测）。备选判据并列：compaction 收尾返回后手动调
 * `runStartupMaintenanceOnce` 断言返回 null（证进程级标记已由 compaction
 * 侧置位、同进程去重生效）。
 *
 * @module test/infra/message-content-compaction-maintenance
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESSAGE_COMPACTION_KKV_MODULE,
  runBlobBinaryNormalization,
  runMessageContentCompaction,
  runStartupMaintenanceOnce,
} from "../../src/infra/db-maintenance/index.js";
import { BLOB_BINARY_KKV_MODULE } from "../../src/infra/db-maintenance/index.js";
import { MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY } from "../../src/infra/db-maintenance/impl/message-content-compaction.js";
import { compressZlib } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

// ---------------------------------------------------------------------------
// SQL 探针：自带 conn.execute 口覆写（VACUUM / wal_checkpoint 走该口）。
// ---------------------------------------------------------------------------

/** 探针记录：语句 + 参数 + 结果行数（execute 为 -1）。 */
interface ProbeRecord {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
}

/** 包一层 SQL 探针：记录下发给连接的语句（query / execute / 事务内 tx）。 */
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

const isVacuum = (sql: string): boolean => /^\s*VACUUM\b/i.test(sql);

describe("收尾维护进程级去重（ic-01①）", () => {
  /**
   * **本文件首条（唯一）进入维护段的用例**：进程级标记初始未消费，
   * compaction 收尾的 `runStartupMaintenanceOnce` 真跑维护（本进程唯一
   * 一次全库 VACUUM），其后 blob 归一的收尾调用被去重短路（返回 null）。
   */
  it("同进程先 compaction 再 blob 归一——全库真跑的 VACUUM 恰 1 次", async () => {
    // 清两侧任务的全部 KKV 标记（完成标记 + pending 兜底，互不牵连）。
    await conn().execute(
      "DELETE FROM kkv_entry WHERE module IN (?, ?)",
      [MESSAGE_COMPACTION_KKV_MODULE, BLOB_BINARY_KKV_MODULE]
    );

    // 两侧任务都有活干（都走到收尾维护段）：
    // 1) compaction 活：一条 legacy 明文行。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
    await conn().execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, created_at_ms, hidden
       ) VALUES ('mc-maint-rowid-1', ?, 1, 'user', ?, ?, 0)`,
      [session.id, JSON.stringify({ blocks: [{ type: "text", text: "去重验证明文行" }] }), Date.now()]
    );
    // 2) blob 归一活：一条 base64 文本存量行（+ entry 引用行，避免收尾
    //    维护链路的 file_cache GC 把语料扫掉——GC 只删无引用 blob 行）。
    const plain = `ic-01 去重验证语料：${"混排标点与数字 0123456789 的长正文。".repeat(40)}`;
    const compressed = compressZlib(new TextEncoder().encode(plain));
    const b64 = Buffer.from(compressed).toString("base64");
    await conn().execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
       VALUES ('mc-maint-hash', 'zlib-b64', ?, ?, 0)`,
      [b64, b64.length]
    );
    await conn().execute(
      `INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms)
       VALUES (?, ?, 'mc-maint-hash', 0)`,
      [session.id, "mc-maint-hash"]
    );

    // compaction 侧回调计数：语义是「进入维护段次数」（含被去重短路的
    // 调用，beforeMaintenance 早于去重判定执行）——本用例只统计 compaction
    // 自己的这一次调用，blob 侧的计数与其叠加必然为 2，不作跨任务 === 1
    // 断言（回调只用于看 busy 置位边界）。
    let beforeCount = 0;
    let afterCount = 0;

    const { records } = await withSqlProbe(async () => {
      const compaction = await runMessageContentCompaction(conn(), {
        beforeMaintenance: () => {
          beforeCount += 1;
        },
        afterMaintenance: () => {
          afterCount += 1;
        },
      });
      assert.equal(compaction.done, true, "compaction 应完成");
      assert.equal(compaction.compactedCount, 1);
      await runBlobBinaryNormalization(conn());
    });

    // 主判据：全库真跑的 VACUUM 恰 1 次（compaction 收尾真跑；blob 归一
    // 收尾被进程级去重短路，不再下发第二条 VACUUM——76MB 量级库的同步
    // 阻塞翻倍正是 ic-01 要收口的事故形态）。
    const vacuumStatements = records.filter((r) => isVacuum(r.sql));
    assert.equal(
      vacuumStatements.length,
      1,
      "同进程双任务叠加只允许一次全库 VACUUM"
    );

    // 回调语义复核：compaction 一次调用进入维护段 1 次；afterMaintenance
    // 是 finally 语义（本用例维护成功，正常触发一次）。
    assert.equal(beforeCount, 1, "beforeMaintenance 恰一次（进入维护段）");
    assert.equal(afterCount, 1, "afterMaintenance 恰一次（finally 复位）");

    // 备选判据（并列，更稳）：compaction 收尾返回后手动调
    // runStartupMaintenanceOnce——进程级标记已由 compaction 侧置位，
    // 同进程重入必须返回 null（证去重生效；compaction 直调旧实现下，
    // 这里会真跑出第二次 VACUUM 而非返回 null）。
    const manual = await runStartupMaintenanceOnce(conn());
    assert.equal(manual, null, "进程级标记已置，同进程重入返回 null");

    // 成功收尾不应残留 pending 兜底标记（维护真跑且未抛错即无补跑证据）。
    const pendingRows = await conn().query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM kkv_entry WHERE module = ? AND key = ?",
      [MESSAGE_COMPACTION_KKV_MODULE, MESSAGE_COMPACTION_MAINTENANCE_PENDING_KKV_KEY]
    );
    assert.equal(
      Number(pendingRows[0]!.n),
      0,
      "维护成功的收尾不应残留 pending 标记"
    );
  });
});
