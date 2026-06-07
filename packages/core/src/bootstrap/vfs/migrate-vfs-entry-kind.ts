/**
 * Adds `vfs_entry.entry_kind` for databases created before the column was in DDL.
 *
 * WHY: `CREATE TABLE IF NOT EXISTS` does not alter existing tables; pragma-guarded
 * ADD COLUMN keeps old `.db` files compatible with directory-node VFS APIs.
 *
 * @module bootstrap/vfs/migrate-vfs-entry-kind
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Idempotent ADD COLUMN for legacy vfs_entry tables missing `entry_kind`. */
export async function migrateVfsEntryKind(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('vfs_entry')",
  );
  if (rows.length === 0) {
    return;
  }
  const names = rows.map((r) => String(r.name));
  if (!names.includes("entry_kind")) {
    await tx.execute(
      "ALTER TABLE vfs_entry ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'file'",
    );
  }
}
