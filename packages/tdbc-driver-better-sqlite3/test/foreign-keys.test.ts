/**
 * T-FK1：foreign_keys pragma 回归测试。
 *
 * 验证 better-sqlite3 驱动 open 后 PRAGMA foreign_keys = ON，
 * 并且 ON DELETE CASCADE 真的会级联删除子表行。
 *
 * @module tdbc-driver-better-sqlite3/test/foreign-keys
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { open } from "@novel-master/core";
import {
  registerBetterSqlite3Driver,
  BETTER_SQLITE3_DRIVER_NAME,
} from "../src/index.js";

// 用 llm_provider / llm_saved_model 这对带 ON DELETE CASCADE 的真实表，
// 比凭空造表更能反映现网语义。DDL 直接内联，避免耦合 bootstrap 内部模块。
// better-sqlite3 的 prepare 不接受多条语句，所以每条建表分开执行。
const SETUP_SQL: readonly string[] = [
  `CREATE TABLE llm_provider (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`,
  `CREATE TABLE llm_saved_model (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
)`,
];

registerBetterSqlite3Driver();

async function openConnection() {
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

describe("T-FK1 foreign_keys pragma", () => {
  it("open 后 PRAGMA foreign_keys 为 ON", async () => {
    const conn = await openConnection();
    try {
      const rows = await conn.query<{ foreign_keys: number }>(
        "PRAGMA foreign_keys",
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].foreign_keys, 1);
    } finally {
      await conn.close();
    }
  });

  it("删除 provider 后 saved_model 被 CASCADE 清空", async () => {
    const conn = await openConnection();
    try {
      for (const stmt of SETUP_SQL) {
        await conn.execute(stmt);
      }

      await conn.execute(
        "INSERT INTO llm_provider (id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)",
        ["provider-1", "测试供应商", 0, 0],
      );
      await conn.batch(
        "INSERT INTO llm_saved_model (id, provider_id, model_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)",
        [
          ["model-1", "provider-1", "m1", 0, 0],
          ["model-2", "provider-1", "m2", 0, 0],
        ],
      );

      // 删父行，子行应被级联删除。
      await conn.execute("DELETE FROM llm_provider WHERE id = ?", [
        "provider-1",
      ]);

      const survivors = await conn.query<{ id: string }>(
        "SELECT id FROM llm_saved_model",
      );
      assert.deepEqual(
        survivors,
        [],
        "CASCADE 没生效：saved_model 还有残留行",
      );
    } finally {
      await conn.close();
    }
  });
});
