/**
 * 消息正文解压搬运入口自愈探测的部分索引 `idx_chat_message_pending_blob`
 * （cr-e1）。
 *
 * 谓词 `content_blob IS NOT NULL` 在建索引前是**全表扫描**：稳态（全部搬完、
 * 零命中）恰是必须读完整棵 b-tree 的形态，而入口探测是每次进程启动的固定
 * 支出（desktop main ready / mobile 延迟 3s / CLI 每条命令）。注释与文档曾
 * 宣称「索引级探测」，落成索引才成立。
 *
 * 三条承重断言：
 * 1. **落点在 bootstrap 事务之外的无条件段**——存量库（user_version =
 *    SCHEMA_BOOT_VERSION）走快路径提前 return，索引必须照样建出来。先例
 *    `idx_chat_session_parent` 在慢路径事务内，照抄位置会让真实用户库永远
 *    建不出本索引（本用例用「建完删掉再 bootstrap」复刻存量库形态）。
 * 2. 探测与 `countPendingRows` 的 COUNT 走索引。
 * 3. 批查询仍走 rowid 主键（`USING INTEGER PRIMARY KEY`），不被新索引拖累。
 *
 * @module test/bootstrap/chat-message-pending-blob-index
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  open,
  SCHEMA_BOOT_VERSION,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";

const INDEX_NAME = "idx_chat_message_pending_blob";

/** 入口自愈探测（与实现的 SQL 逐字一致）。 */
const PROBE_SQL =
  "SELECT 1 AS present FROM chat_message WHERE content_blob IS NOT NULL LIMIT 1";
/** 谓词 COUNT（与实现的 SQL 逐字一致）。 */
const COUNT_SQL =
  "SELECT COUNT(*) AS n FROM chat_message WHERE content_blob IS NOT NULL";
/** keyset 批查询（与实现的 SQL 逐字一致，BATCH_SIZE=100）。 */
const BATCH_SQL = `SELECT rowid, id, content_encoding, content_blob FROM chat_message
       WHERE content_blob IS NOT NULL AND rowid > ?
       ORDER BY rowid
       LIMIT 100`;

/** 开一个内存库。 */
async function openMemoryDb(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

/** EXPLAIN QUERY PLAN 的 detail 列表。 */
async function explain(
  conn: TdbcConnection,
  sql: string,
  parameters?: readonly unknown[]
): Promise<string[]> {
  const rows = await conn.query<{ detail: string }>(
    `EXPLAIN QUERY PLAN ${sql}`,
    parameters
  );
  return rows.map((row) => row.detail);
}

/** 塞两行：一行压缩态、一行明文态（让规划器有真实分布可选）。 */
async function seedRows(conn: TdbcConnection): Promise<void> {
  const insert = async (id: string, seq: number, compressed: boolean) => {
    await conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, content_encoding, content_blob,
         created_at_ms, hidden
       ) VALUES (?, 's-1', ?, 'user', '', ?, ?, ?, 0)`,
      compressed
        ? [id, seq, "zlib", new Uint8Array([0x78, 0x9c, 0, 0]), seq]
        : [id, seq, null, null, seq]
    );
  };
  await insert("m-1", 1, true);
  await insert("m-2", 2, false);
}

describe("解压探测部分索引（cr-e1）", () => {
  it("存量库（user_version = SCHEMA_BOOT_VERSION）走快路径 bootstrap 后索引仍在", async () => {
    const conn = await openMemoryDb();
    await bootstrapNovelMaster(conn);

    // 复刻「本次 DDL 之前的真实用户库」：库已是稳态版本（有索引），
    // 但索引本身没有——存量库正是这个形态。
    await conn.execute(`DROP INDEX ${INDEX_NAME}`);
    const versionRows = await conn.query<{ user_version: number }>(
      "PRAGMA user_version"
    );
    assert.equal(
      Number(versionRows[0]!.user_version),
      SCHEMA_BOOT_VERSION,
      "前置：库已是稳态版本 → 第二次 bootstrap 走快路径（事务内提前 return）"
    );

    await bootstrapNovelMaster(conn);

    const rows = await conn.query<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      [INDEX_NAME]
    );
    assert.equal(
      rows.length,
      1,
      "快路径也必须把索引建出来（落点在事务外的无条件段，不在慢路径事务内）"
    );
    assert.match(
      rows[0]!.sql,
      /WHERE\s+content_blob\s+IS\s+NOT\s+NULL/i,
      "必须是部分索引谓词（只收压缩行）"
    );
    assert.match(
      rows[0]!.sql,
      /ON\s+chat_message\s*\(\s*id\s*\)/i,
      "索引列必须是 id（rowid 不可显式建索引；content_blob 会把字节复制进索引）"
    );

    await conn.close();
  });

  it("EXPLAIN：探测与 COUNT 走 idx_chat_message_pending_blob、批查询仍走 rowid 主键", async () => {
    const conn = await openMemoryDb();
    await bootstrapNovelMaster(conn);
    await seedRows(conn);

    const probePlan = await explain(conn, PROBE_SQL);
    assert.equal(probePlan.length, 1);
    assert.ok(
      probePlan[0]!.includes(INDEX_NAME),
      `入口自愈探测必须走部分索引（实测 plan: ${probePlan[0]}）`
    );

    const countPlan = await explain(conn, COUNT_SQL);
    assert.equal(countPlan.length, 1);
    assert.ok(
      countPlan[0]!.includes(INDEX_NAME),
      `谓词 COUNT 必须走部分索引（实测 plan: ${countPlan[0]}）`
    );

    // 批查询防回归：keyset 走 rowid 主键范围扫，不被部分索引改道（否则每批
    // 要按部分索引取出行再回表，搬运热路径凭空多一跳）。
    const batchPlan = (await explain(conn, BATCH_SQL, [0])).join(" | ");
    assert.match(
      batchPlan,
      /USING\s+INTEGER\s+PRIMARY\s+KEY/i,
      `批查询必须仍走 rowid 主键（实测 plan: ${batchPlan}）`
    );
    assert.ok(
      !batchPlan.includes(INDEX_NAME),
      `批查询不得被部分索引改道（实测 plan: ${batchPlan}）`
    );

    await conn.close();
  });
});
