import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  createVfsService,
  open,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { migrateVfsEntryKind } from "../../src/bootstrap/vfs/migrate-vfs-entry-kind.js";

/** Legacy vfs_entry DDL (pre directory-nodes) without entry_kind. */
const LEGACY_VFS_ENTRY_DDL = `
CREATE TABLE vfs_entry (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  mtime_ms INTEGER NOT NULL,
  storage_kind TEXT NOT NULL DEFAULT 'inline',
  external_uri TEXT
)`.trim();

describe("migrateVfsEntryKind", () => {
  it("adds entry_kind and keeps legacy file rows as file (T6)", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await conn.execute(LEGACY_VFS_ENTRY_DDL, []);
    const mtimeMs = Date.now();
    await conn.execute(
      `INSERT INTO vfs_entry (path, content, version, mtime_ms, storage_kind)
       VALUES ('/foo/.keep', 'placeholder', 1, ?, 'inline')`,
      [mtimeMs],
    );

    await migrateVfsEntryKind(conn);
    await bootstrapNovelMaster(conn);

    const vfs = createVfsService(conn);
    const read = await vfs.read("/foo/.keep");
    assert.equal(read.content, "placeholder");
    const listed = await vfs.list("/foo");
    assert.deepEqual(listed, [{ path: "/foo/.keep", kind: "file" }]);

    await conn.close();
  });
});
