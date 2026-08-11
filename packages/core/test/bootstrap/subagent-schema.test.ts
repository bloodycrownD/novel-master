/**
 * agent-subagent M1 / Step 1 schema 升级测试（T-S1）。
 *
 * 校验 `chat_session.parent_session_id` 列在两种场景下都存在：
 *  1. 新建库 bootstrap 后由 DDL 直接建列；
 *  2. 老库（已升版到 v3，缺 parent_session_id）bootstrap 后由 ALIGN 补列。
 *
 * 另外验证 SCHEMA_BOOT_VERSION 已升到当前版本，以及复合索引 idx_chat_session_parent 存在。
 *
 * @module test/bootstrap/subagent-schema.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  NOVEL_MASTER_SCHEMA_STATEMENTS,
  open,
  SCHEMA_BOOT_VERSION,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

async function openInMemoryConnection(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function tableColumnNames(
  conn: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.map((row) => row.name));
}

async function indexNames(
  conn: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`,
  );
  return new Set(rows.map((row) => row.name));
}

describe("agent-subagent M1 schema（T-S1）", () => {
  it("新建库 bootstrap 后 chat_session.parent_session_id 由 DDL 直接创建", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "chat_session");
      assert.ok(
        columns.has("parent_session_id"),
        "新库 bootstrap 后 chat_session 应有 parent_session_id 列",
      );

      const indexes = await indexNames(conn, "chat_session");
      assert.ok(
        indexes.has("idx_chat_session_parent"),
        "应有复合索引 idx_chat_session_parent",
      );
    } finally {
      await conn.close();
    }
  });

  it("老库（v3，无 parent_session_id）bootstrap 后 ALIGN 补列并升到 v4", async () => {
    const conn = await openInMemoryConnection();
    try {
      // 模拟「已升版到 v3」的老库：手建一份缺 parent_session_id 的 chat_session，
      // 再跑全量 DDL（CREATE IF NOT EXISTS 不会改已有表），最后把 user_version 钉到 3，
      // 这样下次 bootstrap 会走「版本落后 → 跑 DDL + ALIGN」的完整路径。
      await conn.execute(`
        CREATE TABLE chat_session (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT,
          composer_draft_json TEXT NULL,
          agent_config_json TEXT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        )
      `);
      await conn.execute(`
        CREATE INDEX idx_chat_session_project ON chat_session(project_id)
      `);
      for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
        await conn.execute(sql);
      }
      await conn.execute(`PRAGMA user_version = 3`);

      // 升级前确认列不存在。
      assert.equal(
        (await tableColumnNames(conn, "chat_session")).has("parent_session_id"),
        false,
      );

      // 触发升级：bootstrap 检测到 user_version=3 < SCHEMA_BOOT_VERSION，跑 ALIGN。
      await bootstrapNovelMaster(conn);

      const columns = await tableColumnNames(conn, "chat_session");
      assert.ok(
        columns.has("parent_session_id"),
        "老库升级后应通过 ALIGN 补上 parent_session_id",
      );

      // user_version 应已升到当前 SCHEMA_BOOT_VERSION（快路径再次 bootstrap 不应报错也不重建）。
      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version",
      );
      assert.equal(versionRows[0]!.user_version, SCHEMA_BOOT_VERSION);

      // 索引也应该存在（DDL 在升级路径里会跑 CREATE IF NOT EXISTS）。
      const indexes = await indexNames(conn, "chat_session");
      assert.ok(indexes.has("idx_chat_session_parent"));
    } finally {
      await conn.close();
    }
  });

  it("已升版到 v4 的库再 bootstrap 走快路径仍保留列", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn); // 首次：建列 + 升到 v4
      await bootstrapNovelMaster(conn); // 快路径：不应漏列

      const columns = await tableColumnNames(conn, "chat_session");
      assert.ok(columns.has("parent_session_id"));
    } finally {
      await conn.close();
    }
  });
});
