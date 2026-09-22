/**
 * session_file_cache_* 两表 schema 升级测试
 * （storage-cache-dedup-and-cleanup Step 1 / T-S1~T-S3）。
 *
 * 校验 `session_file_cache_blob` / `session_file_cache_entry` 两表与
 * `idx_session_file_cache_hash` 索引在三种场景下的行为：
 *  1. 新建库 bootstrap 后由 DDL 直接建出（T-S1）；
 *  2. 老库（user_version 落后一代、无两表）bootstrap 后走慢路径补建（T-S2）；
 *  3. 已升版库（user_version 达基线，快路径）重复 bootstrap 幂等不报错（T-S3）。
 *
 * 断言引用 SCHEMA_BOOT_VERSION 常量而非字面量，随版本 bump 自适应。
 *
 * @module test/bootstrap/file-cache-schema.test
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

async function objectExists(
  conn: TdbcConnection,
  type: "table" | "index",
  name: string
): Promise<boolean> {
  const rows = await conn.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = '${type}' AND name = '${name}'`
  );
  return rows.length > 0;
}

/** 两表 + 索引三件套齐全（T-S1/T-S2 共用断言）。 */
async function assertFileCacheSchemaReady(conn: TdbcConnection): Promise<void> {
  assert.equal(
    await objectExists(conn, "table", "session_file_cache_blob"),
    true,
    "session_file_cache_blob 表应存在"
  );
  assert.equal(
    await objectExists(conn, "table", "session_file_cache_entry"),
    true,
    "session_file_cache_entry 表应存在"
  );
  assert.equal(
    await objectExists(conn, "index", "idx_session_file_cache_hash"),
    true,
    "idx_session_file_cache_hash 索引应存在"
  );
}

describe("session_file_cache 两表 schema 升级", () => {
  it("T-S1：新建库 bootstrap 后由 DDL 直接建出两表与索引", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      await assertFileCacheSchemaReady(conn);
      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]!.user_version, SCHEMA_BOOT_VERSION);
    } finally {
      await conn.close();
    }
  });

  it("T-S2：老库（落后一代、缺两表）bootstrap 后慢路径补建并升版", async () => {
    const conn = await openInMemoryConnection();
    try {
      // 模拟「已升版到上一代」的老库：完整 bootstrap 后删掉两张新表
      // （随表索引一并消亡），把 user_version 钉回 SCHEMA_BOOT_VERSION - 1，
      // 下次 bootstrap 会走「版本落后 → 跑 DDL」的慢路径。
      await bootstrapNovelMaster(conn);
      await conn.execute("DROP TABLE session_file_cache_entry");
      await conn.execute("DROP TABLE session_file_cache_blob");
      await conn.execute(`PRAGMA user_version = ${SCHEMA_BOOT_VERSION - 1}`);
      assert.equal(
        await objectExists(conn, "table", "session_file_cache_blob"),
        false
      );
      assert.equal(
        await objectExists(conn, "table", "session_file_cache_entry"),
        false
      );

      await bootstrapNovelMaster(conn);

      await assertFileCacheSchemaReady(conn);
      const versionRows = await conn.query<{ user_version: number }>(
        "PRAGMA user_version"
      );
      assert.equal(versionRows[0]!.user_version, SCHEMA_BOOT_VERSION);

      // 建出的表可正常写入（列清单与 CHECK 约束与仓储契约一致）：
      // blob 用 x'' 十六进制字面量写 BLOB，不经绑定参数。
      await conn.execute(`
        INSERT INTO session_file_cache_blob (content_hash, encoding, bytes, byte_len)
        VALUES ('h1', 'zlib', x'010203', 3)
      `);
      await conn.execute(`
        INSERT INTO session_file_cache_entry (session_id, key, content_hash, mtime_ms)
        VALUES ('s', 'full:/a.md', 'h1', 123)
      `);
    } finally {
      await conn.close();
    }
  });

  it("T-S3：已升版库（快路径）重复 bootstrap 幂等不报错", async () => {
    const conn = await openInMemoryConnection();
    try {
      await bootstrapNovelMaster(conn);
      // user_version 已达 SCHEMA_BOOT_VERSION，第二次 bootstrap 走快路径
      // （跳过 DDL），两表与索引保持存在、不报错。
      await bootstrapNovelMaster(conn);
      await assertFileCacheSchemaReady(conn);
    } finally {
      await conn.close();
    }
  });
});
