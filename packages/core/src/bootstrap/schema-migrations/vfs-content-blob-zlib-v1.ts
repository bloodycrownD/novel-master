/**
 * vfs-content-blob-zlib-v1：blob 表 + vfs_entry 可空化 rebuild + content_hash 回填。
 *
 * @module bootstrap/schema-migrations/vfs-content-blob-zlib-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { VFS_CONTENT_BLOB_TABLE_DDL } from "../vfs/vfs-content-blob-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const VFS_CONTENT_BLOB_ZLIB_V1_ID = "vfs-content-blob-zlib-v1";

type PragmaColumn = {
  name: string;
  notnull: number;
};

async function getTableColumns(
  tx: TdbcConnection,
  table: string,
): Promise<PragmaColumn[]> {
  const rows = await tx.query<{ name: string; notnull: number }>(
    `PRAGMA table_info(${table})`,
  );
  return rows.map((row) => ({
    name: String(row.name),
    notnull: Number(row.notnull ?? 0),
  }));
}

async function columnNames(
  tx: TdbcConnection,
  table: string,
): Promise<Set<string>> {
  const cols = await getTableColumns(tx, table);
  return new Set(cols.map((c) => c.name));
}

function needsEntryRebuild(cols: PragmaColumn[]): boolean {
  const byName = new Map(cols.map((c) => [c.name, c]));
  if (!byName.has("content_hash")) {
    return true;
  }
  const content = byName.get("content");
  // 旧库 content NOT NULL → 必须 rebuild；缺列同理。
  if (content == null || content.notnull === 1) {
    return true;
  }
  return false;
}

/**
 * 旧库 vfs_entry table rebuild：content TEXT NULL + content_hash，去掉 NOT NULL。
 */
async function rebuildVfsEntryIfNeeded(tx: TdbcConnection): Promise<void> {
  const cols = await getTableColumns(tx, "vfs_entry");
  if (cols.length === 0) {
    return;
  }
  if (!needsEntryRebuild(cols)) {
    return;
  }

  const names = new Set(cols.map((c) => c.name));
  await tx.execute(`DROP INDEX IF EXISTS idx_vfs_entry_path_prefix`);

  await tx.execute(`
    CREATE TABLE vfs_entry_new (
      path TEXT PRIMARY KEY,
      content TEXT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      head_version INTEGER NOT NULL DEFAULT 1,
      mtime_ms INTEGER NOT NULL,
      storage_kind TEXT NOT NULL DEFAULT 'inline',
      external_uri TEXT,
      entry_kind TEXT NOT NULL DEFAULT 'file',
      content_hash TEXT NULL
    )
  `);

  const hasHead = names.has("head_version");
  const hasKind = names.has("entry_kind");
  const hasExternal = names.has("external_uri");
  const hasHash = names.has("content_hash");

  await tx.execute(`
    INSERT INTO vfs_entry_new (
      path, content, version, head_version, mtime_ms,
      storage_kind, external_uri, entry_kind, content_hash
    )
    SELECT
      path,
      content,
      version,
      ${hasHead ? "head_version" : "version"},
      mtime_ms,
      storage_kind,
      ${hasExternal ? "external_uri" : "NULL"},
      ${hasKind ? "entry_kind" : "'file'"},
      ${hasHash ? "content_hash" : "NULL"}
    FROM vfs_entry
  `);

  await tx.execute(`DROP TABLE vfs_entry`);
  await tx.execute(`ALTER TABLE vfs_entry_new RENAME TO vfs_entry`);
  await tx.execute(`
    CREATE INDEX IF NOT EXISTS idx_vfs_entry_path_prefix ON vfs_entry(path)
  `);
}

async function ensureRevisionContentHash(tx: TdbcConnection): Promise<void> {
  const names = await columnNames(tx, "vfs_revision");
  if (names.size === 0 || names.has("content_hash")) {
    return;
  }
  await tx.execute(
    `ALTER TABLE vfs_revision ADD COLUMN content_hash TEXT NULL`,
  );
}

/**
 * 仍有明文的行 → put → 写 hash → content=NULL；目录行双 NULL。可重入。
 */
async function migratePlaintextToBlobs(tx: TdbcConnection): Promise<void> {
  const store = new SqliteVfsContentStore(tx);

  const entries = await tx.query<{
    path: string;
    content: string | null;
    content_hash: string | null;
    entry_kind: string;
  }>(
    `SELECT path, content, content_hash, entry_kind FROM vfs_entry`,
  );

  for (const row of entries) {
    if (row.entry_kind === "directory") {
      if (row.content != null || row.content_hash != null) {
        await tx.execute(
          `UPDATE vfs_entry SET content = NULL, content_hash = NULL WHERE path = ?`,
          [row.path],
        );
      }
      continue;
    }

    // 已迁完：有 hash 且 content 已 NULL
    if (row.content_hash != null && row.content == null) {
      continue;
    }

    if (row.content != null) {
      const hash = await store.put(row.content);
      await tx.execute(
        `UPDATE vfs_entry SET content_hash = ?, content = NULL WHERE path = ?`,
        [hash, row.path],
      );
      continue;
    }

    // 文件行双 NULL：迁移窗口外视为异常，跳过（读路径会报错）
  }

  const revisions = await tx.query<{
    path: string;
    version: number;
    content: string | null;
    content_hash: string | null;
    status: string;
  }>(
    `SELECT path, version, content, content_hash, status FROM vfs_revision`,
  );

  for (const row of revisions) {
    if (row.status === "deleted") {
      if (row.content != null || row.content_hash != null) {
        await tx.execute(
          `UPDATE vfs_revision SET content = NULL, content_hash = NULL
           WHERE path = ? AND version = ?`,
          [row.path, row.version],
        );
      }
      continue;
    }

    if (row.content_hash != null && row.content == null) {
      continue;
    }

    if (row.content != null) {
      const hash = await store.put(row.content);
      await tx.execute(
        `UPDATE vfs_revision SET content_hash = ?, content = NULL
         WHERE path = ? AND version = ?`,
        [hash, row.path, row.version],
      );
    }
  }
}

/**
 * 路径 A：旧库 rebuild + 明文迁 blob。
 * 路径 B：canonical DDL 已完整且无待迁明文 → 仅确保 blob 表，实质 no-op。
 */
async function up(tx: TdbcConnection): Promise<void> {
  await tx.execute(VFS_CONTENT_BLOB_TABLE_DDL);
  await rebuildVfsEntryIfNeeded(tx);
  await ensureRevisionContentHash(tx);
  await migratePlaintextToBlobs(tx);
}

/** 正文迁入 zlib 内容寻址存储；vfs_entry.content 可空化。 */
export const vfsContentBlobZlibV1Migration: SchemaMigration = {
  id: VFS_CONTENT_BLOB_ZLIB_V1_ID,
  up,
};

export { up as vfsContentBlobZlibV1Up };
