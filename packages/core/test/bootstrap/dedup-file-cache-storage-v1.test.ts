/**
 * dedup-file-cache-storage-v1 migration 行为测试
 * （storage-cache-dedup-and-cleanup：清空 file_cache 域存量缓存行）。
 *
 * 覆盖（照 add-mcp-file-path-snapshot-v1 测试模式）：
 *  1. 登记：migration 注册于 SCHEMA_MIGRATIONS 阵尾；
 *  2. T-M1 迁移语义（up 直调）：多会话 file_cache 行清空、rule_snapshot
 *     与其他域（backfill_cursor）行保留（AC-A1 清空口径）；
 *  3. T-M2 幂等：重复执行删 0 行不报错（AC-A5 迁移可重入）；
 *  4. T-M2 登记：runner（快路径场景）执行后 schema_migrations 有登记
 *     且经 runner 路径同样完成清空。
 *
 * @module test/bootstrap/dedup-file-cache-storage-v1.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import type { TdbcConnection } from "@novel-master/core";
import {
  DEDUP_FILE_CACHE_STORAGE_V1_ID,
  dedupFileCacheStorageV1Up,
} from "../../src/bootstrap/schema-migrations/dedup-file-cache-storage-v1.js";
import {
  SCHEMA_MIGRATIONS,
  runPendingSchemaMigrations,
} from "../../src/bootstrap/schema-migrations/index.js";

/** 迁移前的 session_kkv_entry 形态（与 canonical DDL 同构）。 */
const SESSION_KKV_ENTRY_DDL = `
  CREATE TABLE IF NOT EXISTS session_kkv_entry (
    session_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (session_id, domain, key)
  )
`;

async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  return conn;
}

/** 模拟迁移前存量库：三个会话的 file_cache 行 + rule_snapshot + backfill_cursor。 */
async function seedLegacyShape(conn: TdbcConnection): Promise<void> {
  await conn.execute(SESSION_KKV_ENTRY_DDL);
  // 同一文件被多会话各抄一份（膨胀形态）：s1/s2/s3 各有 full:/a.md，
  // s1 另有 header:/a.md 档位行。
  await conn.execute(`
    INSERT INTO session_kkv_entry (session_id, domain, key, value) VALUES
      ('s1', 'file_cache', 'full:/a.md', '{"body":"aaa","mtimeMs":1}'),
      ('s1', 'file_cache', 'header:/a.md', '{"body":"aaahead","mtimeMs":1}'),
      ('s2', 'file_cache', 'full:/a.md', '{"body":"aaa","mtimeMs":2}'),
      ('s3', 'file_cache', 'full:/a.md', '{"body":"aaa","mtimeMs":3}'),
      ('s1', 'rule_snapshot', 'canon', '{"rules":[]}'),
      ('s2', 'rule_snapshot', 'canon', '{"rules":[]}'),
      ('s1', 'backfill_cursor', 'lastScannedCount', '42')
  `);
}

/** 除本迁移外全部登记为 applied（模拟迁移前存量库状态）。 */
async function markPriorMigrationsApplied(conn: TdbcConnection): Promise<void> {
  await conn.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at_ms INTEGER NOT NULL
     )`
  );
  for (const migration of SCHEMA_MIGRATIONS) {
    if (migration.id === DEDUP_FILE_CACHE_STORAGE_V1_ID) {
      continue;
    }
    await conn.execute(
      `INSERT OR IGNORE INTO schema_migrations (id, applied_at_ms) VALUES (?, ?)`,
      [migration.id, 1]
    );
  }
}

/** 按域统计行数。 */
async function countByDomain(
  conn: TdbcConnection,
  domain: string
): Promise<number> {
  const rows = await conn.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM session_kkv_entry WHERE domain = '${domain}'`
  );
  return Number(rows[0]?.cnt ?? 0);
}

describe("dedup-file-cache-storage-v1 migration", () => {
  it("登记于 SCHEMA_MIGRATIONS 阵尾", () => {
    assert.equal(
      SCHEMA_MIGRATIONS.at(-1)?.id,
      DEDUP_FILE_CACHE_STORAGE_V1_ID
    );
  });

  it("T-M1 迁移语义（up 直调）：多会话 file_cache 行清空、rule_snapshot 与 backfill_cursor 保留", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);

      await dedupFileCacheStorageV1Up(conn);

      assert.equal(
        await countByDomain(conn, "file_cache"),
        0,
        "file_cache 域行应全部清空"
      );
      assert.equal(
        await countByDomain(conn, "rule_snapshot"),
        2,
        "rule_snapshot 域行应保留"
      );
      assert.equal(
        await countByDomain(conn, "backfill_cursor"),
        1,
        "backfill_cursor 域行应保留"
      );
    } finally {
      await conn.close();
    }
  });

  it("T-M2 幂等：重复执行删 0 行不报错", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);
      await dedupFileCacheStorageV1Up(conn);

      // 二跑：已是清空后形态，DELETE 命中 0 行、不报错、其他域不动。
      await dedupFileCacheStorageV1Up(conn);

      assert.equal(await countByDomain(conn, "file_cache"), 0);
      assert.equal(await countByDomain(conn, "rule_snapshot"), 2);
      assert.equal(await countByDomain(conn, "backfill_cursor"), 1);
    } finally {
      await conn.close();
    }
  });

  it("T-M2 登记：runner（快路径场景）执行后 schema_migrations 有登记且完成清空", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);
      await markPriorMigrationsApplied(conn);

      await runPendingSchemaMigrations(conn);

      const applied = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = '${DEDUP_FILE_CACHE_STORAGE_V1_ID}'`
      );
      assert.equal(applied.length, 1, "迁移应登记 applied");
      assert.equal(await countByDomain(conn, "file_cache"), 0);
      assert.equal(await countByDomain(conn, "rule_snapshot"), 2);
      assert.equal(await countByDomain(conn, "backfill_cursor"), 1);
    } finally {
      await conn.close();
    }
  });
});
