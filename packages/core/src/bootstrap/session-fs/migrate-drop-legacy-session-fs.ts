/**
 * Drops legacy session-fs batch/snapshot tables (no data migration).
 *
 * WHY: message checkpoint v2 replaces `session_execute_*` and
 * `session_vfs_snapshot`; upgrade abandons pre-v2 rollback points.
 *
 * @module bootstrap/session-fs/migrate-drop-legacy-session-fs
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Child tables first — SQLite has no FK enforcement but keeps DROP order explicit. */
const LEGACY_TABLES = [
  "session_execute_action",
  "session_execute_checkpoint",
  "session_execute_batch",
  "session_vfs_snapshot",
] as const;

/** Idempotent DROP for legacy session-fs tables. */
export async function migrateDropLegacySessionFs(
  tx: TdbcConnection,
): Promise<void> {
  for (const table of LEGACY_TABLES) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`);
  }
}
