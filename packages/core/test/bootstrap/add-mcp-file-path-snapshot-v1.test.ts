/**
 * add-mcp-file-path-snapshot-v1 migration 行为测试
 * （rollback-restore-deleted-entry：message_checkpoint_file 加 path 快照列）。
 *
 * 覆盖（照 add-smart-sort-capture-kind-v1 四段式）：
 *  1. 登记：migration 注册于 SCHEMA_MIGRATIONS 阵尾；
 *  2. 迁移语义（up 直调）：旧形态表（无 path 列）ALTER ADD COLUMN 可空尾列 +
 *     存量行按 entry_id 回填现路径 + entry 已删的行留 NULL + 已是新形态时二跑早退；
 *  3. 快路径场景（旧形态存量库 + 前序 migration 已 applied）：runner 仍执行
 *     本迁移（pending migration 不受 bootVersion 快路径短路）；
 *  4. bootstrap 集成：全流程后新库 canonical DDL 直接建出 path 列，
 *     capture 写入的 path 快照可读出。
 *
 * @module test/bootstrap/add-mcp-file-path-snapshot-v1.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import type { TdbcConnection } from "@novel-master/core";
import {
  ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID,
  addMcpFilePathSnapshotV1Up,
} from "../../src/bootstrap/schema-migrations/add-mcp-file-path-snapshot-v1.js";
import {
  SCHEMA_MIGRATIONS,
  runPendingSchemaMigrations,
} from "../../src/bootstrap/schema-migrations/index.js";

/** 迁移前的 message_checkpoint_file 形态（无 path 列，PK 不变）。 */
const LEGACY_MCP_FILE_DDL = `
  CREATE TABLE IF NOT EXISTS message_checkpoint_file (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    entry_id INTEGER NOT NULL,
    revision_version INTEGER NOT NULL CHECK (revision_version >= 1),
    PRIMARY KEY (session_id, message_id, entry_id)
  ) WITHOUT ROWID
`;

async function openMemoryConn(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  return conn;
}

/** 旧形态表 + vfs_entry 支撑表 + 存量 checkpoint 行（entry 一活一删）。 */
async function seedLegacyShape(conn: TdbcConnection): Promise<void> {
  await conn.execute(LEGACY_MCP_FILE_DDL);
  await conn.execute(`
    CREATE TABLE vfs_entry (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      head_version INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      entry_kind TEXT NOT NULL,
      content TEXT,
      UNIQUE (scope_key, path)
    )
  `);
  await conn.execute(
    `INSERT INTO vfs_entry (scope_key, path, content_hash, head_version, mtime_ms, entry_kind) VALUES
       ('session:p:s', '/alive.md', 'h1', 1, 1, 'file'),
       ('session:p:s', '/removed.md', 'h2', 1, 1, 'file')`
  );
  await conn.execute(
    `INSERT INTO message_checkpoint_file (session_id, message_id, entry_id, revision_version) VALUES
       ('s', 'm1', 1, 1),
       ('s', 'm1', 2, 3)`
  );
  // 模拟 entry 2 已被删除（物理 DELETE）。
  await conn.execute(`DELETE FROM vfs_entry WHERE entry_id = 2`);
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
    if (migration.id === ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID) {
      continue;
    }
    await conn.execute(
      `INSERT OR IGNORE INTO schema_migrations (id, applied_at_ms) VALUES (?, ?)`,
      [migration.id, 1]
    );
  }
}

describe("add-mcp-file-path-snapshot-v1 migration", () => {
  it("登记于 SCHEMA_MIGRATIONS 阵尾", () => {
    assert.equal(
      SCHEMA_MIGRATIONS.at(-1)?.id,
      ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID
    );
  });

  it("迁移语义（up 直调）：加列 + entry 在的回填现路径 + entry 删的留 NULL + 幂等", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);

      await addMcpFilePathSnapshotV1Up(conn);

      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('message_checkpoint_file')`
      );
      assert.ok(
        cols.map((r) => String(r.name)).includes("path"),
        "path 列应就位"
      );

      // entry 还在的行回填现路径；entry 已删的子查询得 NULL、留 NULL。
      const rows = await conn.query<{
        entry_id: number;
        path: string | null;
      }>(
        `SELECT entry_id, path FROM message_checkpoint_file ORDER BY entry_id`
      );
      assert.deepEqual(
        rows.map((r) => ({ entryId: Number(r.entry_id), path: r.path })),
        [
          { entryId: 1, path: "/alive.md" },
          { entryId: 2, path: null },
        ]
      );

      // 幂等：已是新形态时 up 直调二跑早退不报错、数据不动。
      await addMcpFilePathSnapshotV1Up(conn);
      const again = await conn.query<{ path: string | null }>(
        `SELECT path FROM message_checkpoint_file WHERE entry_id = 1`
      );
      assert.equal(again[0]?.path, "/alive.md");
    } finally {
      await conn.close();
    }
  });

  it("快路径场景：旧形态库（前序已 applied、user_version 达基线）runner 仍执行本迁移", async () => {
    const conn = await openMemoryConn();
    try {
      await seedLegacyShape(conn);
      await markPriorMigrationsApplied(conn);
      await conn.execute(`PRAGMA user_version = 13`);

      await runPendingSchemaMigrations(conn);

      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('message_checkpoint_file')`
      );
      assert.ok(
        cols.map((r) => String(r.name)).includes("path"),
        "快路径仍应补列"
      );
      const filled = await conn.query<{ path: string | null }>(
        `SELECT path FROM message_checkpoint_file WHERE entry_id = 1`
      );
      assert.equal(filled[0]?.path, "/alive.md", "快路径也应完成回填");
      const applied = await conn.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = '${ADD_MCP_FILE_PATH_SNAPSHOT_V1_ID}'`
      );
      assert.equal(applied.length, 1, "迁移应登记 applied");
    } finally {
      await conn.close();
    }
  });

  it("bootstrap 集成：canonical DDL 直接建出 path 列且 capture 快照可读", async () => {
    const conn = await openMemoryConn();
    try {
      await bootstrapNovelMaster(conn);

      // 新库 canonical DDL 直接带列（migration 探测早退，不重复 ALTER）。
      const cols = await conn.query<{ name: string }>(
        `SELECT name FROM pragma_table_info('message_checkpoint_file')`
      );
      assert.ok(
        cols.map((r) => String(r.name)).includes("path"),
        "新库应直接建出 path 列"
      );

      // capture 链路写入 path 快照后，直接 SQL 可读回。
      await conn.execute(
        `INSERT INTO message_checkpoint (session_id, message_id, created_at_ms)
         VALUES ('s-int', 'm-int', 1)`
      );
      const seqRows = await conn.query<{ entry_id: number }>(
        `INSERT INTO vfs_entry (scope_key, path, content_hash, head_version, mtime_ms, entry_kind)
         VALUES ('session:p:s-int', '/snap.md', 'h', 1, 1, 'file')
         RETURNING entry_id`
      );
      await conn.execute(
        `INSERT INTO message_checkpoint_file (session_id, message_id, entry_id, revision_version, path)
         VALUES ('s-int', 'm-int', ?, 1, '/snap.md')`,
        [Number(seqRows[0]!.entry_id)]
      );
      const snap = await conn.query<{ path: string }>(
        `SELECT path FROM message_checkpoint_file WHERE session_id = 's-int' AND message_id = 'm-int'`
      );
      assert.equal(snap[0]?.path, "/snap.md");
    } finally {
      await conn.close();
    }
  });
});
