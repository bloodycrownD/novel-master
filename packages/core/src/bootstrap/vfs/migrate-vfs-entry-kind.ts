/**
 * Idempotent migration: add vfs_entry.entry_kind for directory nodes.
 *
 * @module bootstrap/vfs/migrate-vfs-entry-kind
 *
 * @remarks
 * After all dev databases are recreated from the updated DDL, this ALTER may be removed.
 * Existing DBs without the column rely on PRAGMA + ADD COLUMN (same pattern as chat `hidden`).
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/**
 * Adds `entry_kind TEXT NOT NULL DEFAULT 'file'` when missing.
 */
export async function migrateVfsEntryKind(
  conn: TdbcConnection,
): Promise<void> {
  const rows = await conn.query(
    "PRAGMA table_info(vfs_entry)",
    [],
  );
  const hasKind = rows.some((row) => String(row.name) === "entry_kind");
  if (hasKind) {
    return;
  }
  await conn.execute(
    `ALTER TABLE vfs_entry ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'file'`,
    [],
  );
}
