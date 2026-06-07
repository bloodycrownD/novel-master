/**
 * Adds `vfs_entry.head_version` and backfills from legacy `version`.
 *
 * WHY: checkpoint pointers reference head_version; legacy DBs only had `version`.
 *
 * @module bootstrap/vfs/migrate-vfs-head-version
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Idempotent ADD COLUMN + backfill for vfs_entry.head_version. */
export async function migrateVfsHeadVersion(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('vfs_entry')",
  );
  if (rows.length === 0) {
    return;
  }
  const names = rows.map((r) => String(r.name));
  if (!names.includes("head_version")) {
    await tx.execute(
      "ALTER TABLE vfs_entry ADD COLUMN head_version INTEGER NOT NULL DEFAULT 1",
    );
  }
  await tx.execute("UPDATE vfs_entry SET head_version = version");
}
