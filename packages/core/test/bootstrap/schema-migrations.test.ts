import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  isSchemaMigrationApplied,
  markSchemaMigrationApplied,
  SCHEMA_MIGRATIONS,
} from "../../src/bootstrap/schema-migrations/index.js";

async function openMemoryConn() {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

describe("schema migrations（T-SM1 / T-SM2 框架）", () => {
  it("空库 bootstrap 后存在 schema_migrations 表", async () => {
    const conn = await openMemoryConn();
    try {
      await bootstrapNovelMaster(conn);
      const rows = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
      );
      assert.equal(rows.length, 1);
    } finally {
      await conn.close();
    }
  });

  it("二次 bootstrap 幂等且不抛错", async () => {
    const conn = await openMemoryConn();
    try {
      await bootstrapNovelMaster(conn);
      await bootstrapNovelMaster(conn);
    } finally {
      await conn.close();
    }
  });

  it("SCHEMA_MIGRATIONS 注册 id 唯一", () => {
    const ids = SCHEMA_MIGRATIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("markSchemaMigrationApplied 后 isSchemaMigrationApplied 为 true", async () => {
    const conn = await openMemoryConn();
    try {
      await conn.transaction(async (tx) => {
        const { ensureSchemaMigrationsTable } = await import(
          "../../src/bootstrap/schema-migrations/schema-migrations-table.js"
        );
        await ensureSchemaMigrationsTable(tx);
        assert.equal(await isSchemaMigrationApplied(tx, "test-v0"), false);
        await markSchemaMigrationApplied(tx, "test-v0", 1);
        assert.equal(await isSchemaMigrationApplied(tx, "test-v0"), true);
      });
    } finally {
      await conn.close();
    }
  });
});
