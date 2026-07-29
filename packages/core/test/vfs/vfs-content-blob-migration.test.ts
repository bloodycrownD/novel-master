/**
 * T-MG1：旧 TEXT NOT NULL fixture 经 rebuild 后可读、可重入；目录双 NULL。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  open,
  type TdbcConnection,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import {
  isSchemaMigrationApplied,
  VFS_CONTENT_BLOB_ZLIB_V1_ID,
} from "@/bootstrap/schema-migrations/index.js";

async function openMemory(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  return open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
}

async function columnInfo(
  conn: TdbcConnection,
  table: string,
): Promise<Array<{ name: string; notnull: number }>> {
  const rows = await conn.query<{ name: string; notnull: number }>(
    `PRAGMA table_info(${table})`,
  );
  return rows.map((row) => ({
    name: String(row.name),
    notnull: Number(row.notnull ?? 0),
  }));
}

/** 模拟迁移前旧库：content TEXT NOT NULL、无 content_hash / blob 表。 */
async function seedLegacyInlineVfs(conn: TdbcConnection): Promise<void> {
  await conn.execute(`
    CREATE TABLE vfs_entry (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      head_version INTEGER NOT NULL DEFAULT 1,
      mtime_ms INTEGER NOT NULL,
      storage_kind TEXT NOT NULL DEFAULT 'inline',
      external_uri TEXT,
      entry_kind TEXT NOT NULL DEFAULT 'file'
    )
  `);
  await conn.execute(`
    CREATE TABLE vfs_revision (
      path TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT,
      status TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      storage_kind TEXT NOT NULL DEFAULT 'inline',
      PRIMARY KEY (path, version)
    )
  `);
  await conn.execute(
    `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind)
     VALUES (?, ?, 1, 1, ?, 'inline', 'file')`,
    ["/projects/legacy-p/sessions/legacy-s/a.md", "旧明文正文", Date.now()],
  );
  await conn.execute(
    `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind)
     VALUES (?, ?, 1, 1, ?, 'inline', 'directory')`,
    ["/projects/legacy-p/sessions/legacy-s/dir", "", Date.now()],
  );
  await conn.execute(
    `INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind)
     VALUES (?, 1, ?, 'active', ?, 'inline')`,
    ["/projects/legacy-p/sessions/legacy-s/a.md", "旧明文正文", Date.now()],
  );
}

describe("vfs-content-blob-zlib-v1 migration", () => {
  it("T-MG1: rebuild 可空化 + 迁 blob + 二次 bootstrap 可重入", async () => {
    const conn = await openMemory();
    try {
      await seedLegacyInlineVfs(conn);
      const before = await columnInfo(conn, "vfs_entry");
      const contentBefore = before.find((c) => c.name === "content");
      assert.ok(contentBefore);
      assert.equal(contentBefore.notnull, 1);

      await bootstrapNovelMaster(conn);

      const after = await columnInfo(conn, "vfs_entry");
      const contentAfter = after.find((c) => c.name === "content");
      const hashCol = after.find((c) => c.name === "content_hash");
      assert.ok(contentAfter);
      assert.equal(contentAfter.notnull, 0);
      assert.ok(hashCol);

      assert.equal(
        await isSchemaMigrationApplied(conn, VFS_CONTENT_BLOB_ZLIB_V1_ID),
        true,
      );

      const fileRow = await conn.query<{
        content: string | null;
        content_hash: string | null;
      }>(`SELECT content, content_hash FROM vfs_entry WHERE path = ?`, [
        "/a.md",
      ]);
      assert.equal(fileRow[0]!.content, null);
      assert.ok(fileRow[0]!.content_hash);

      const dirRow = await conn.query<{
        content: string | null;
        content_hash: string | null;
      }>(`SELECT content, content_hash FROM vfs_entry WHERE path = ?`, [
        "/dir",
      ]);
      assert.equal(dirRow[0]!.content, null);
      assert.equal(dirRow[0]!.content_hash, null);

      const store = new SqliteVfsContentStore(conn);
      assert.equal(
        await store.get(fileRow[0]!.content_hash!),
        "旧明文正文",
      );

      // 二次 bootstrap 可重入
      await bootstrapNovelMaster(conn);
      assert.equal(
        await store.get(fileRow[0]!.content_hash!),
        "旧明文正文",
      );
      const blobs = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [fileRow[0]!.content_hash],
      );
      assert.equal(Number(blobs[0]!.n), 1);
    } finally {
      await conn.close();
    }
  });
});
