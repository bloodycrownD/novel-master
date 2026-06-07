/**
 * Seeds vfs_revision baseline rows from live vfs_entry file heads.
 *
 * WHY: upgrades retain working files; baseline rows are NOT legacy rollback points.
 * Idempotent — skips paths that already have a revision for their head version.
 *
 * @module bootstrap/vfs/migrate-vfs-revision
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Inserts missing head revisions for existing live file entries. */
export async function migrateVfsRevisionBaseline(
  tx: TdbcConnection,
): Promise<void> {
  const revisionTable = await tx.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vfs_revision'",
  );
  if (revisionTable.length === 0) {
    return;
  }

  await tx.execute(`
INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind)
SELECT
  e.path,
  e.head_version,
  e.content,
  'active',
  e.mtime_ms,
  e.storage_kind
FROM vfs_entry e
WHERE e.entry_kind = 'file'
  AND NOT EXISTS (
    SELECT 1 FROM vfs_revision r
    WHERE r.path = e.path AND r.version = e.head_version
  )`);
}
