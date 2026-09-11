/**
 * session_run_state 表 schema 升级测试。
 *
 * 校验 `session_run_state` 在两种场景下都存在：
 *  1. 新建库 bootstrap 后由 DDL 直接建表；
 *  2. 老库（user_version 落后一代、无该表）bootstrap 后走慢路径补建表。
 *
 * 断言引用 SCHEMA_BOOT_VERSION 常量而非字面量，随版本 bump 自适应。
 *
 * @module test/bootstrap/session-run-state-schema.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
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

async function tableExists(
  conn: TdbcConnection,
  table: string
): Promise<boolean> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
  );
  return rows.length > 0;
}

describe("session_run_state schema 升级", () => {
  it("新建库 bootstrap 后由 DDL 直接建表", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      assert.equal(await tableExists(conn, "session_run_state"), true);
      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]!.user_version, SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });

  it("老库（落后一代、缺表）bootstrap 后慢路径补建表并升版", async () => {
    const conn = await openInMemoryConnection();
    try {
      // 模拟「已升版到上一代」的老库：完整 bootstrap 后删掉新表、
      // 把 user_version 钉回 SCHEMA_BOOT_VERSION - 1，下次 bootstrap
      // 会走「版本落后 → 跑 DDL」的慢路径。
      await bootstrapNovelMaster(conn);
      await conn.execute("DROP TABLE session_run_state");
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION - 1}`);
      assert.equal(await tableExists(conn, "session_run_state"), false);

      await bootstrapNovelMaster(conn);

      assert.equal(
        await tableExists(conn, "session_run_state"),
        true,
        "老库升级后应由慢路径 DDL 补建 session_run_state"
      );
      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]!.user_version, SCHEMA_BOOT_VERSION);

      // 建出的表可正常写入（列清单与 CHECK 约束与仓储契约一致）。
      await conn.execute(`
        INSERT INTO session_run_state (
          session_id, project_id, run_id, status, started_at_ms,
          text_chars, thinking_chars, partial_text, partial_thinking,
          pending_children_json, updated_at_ms
        ) VALUES ('s', 'p', 'r', 'running', 1, 0, 0, NULL, NULL, NULL, 1)
      `);
    } finally {
      await conn.close();
    }
  });

  it("已升版库再 bootstrap 走快路径仍保留表", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      await bootstrapNovelMaster(conn);
      assert.equal(await tableExists(conn, "session_run_state"), true);
    } finally {
      await conn.close();
    }
  });
});
