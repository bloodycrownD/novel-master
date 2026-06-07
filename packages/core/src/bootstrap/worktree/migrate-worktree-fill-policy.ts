/**
 * Normalizes legacy `worktree_dir_rule.fill_policy = 'full'` to `hidden`.
 *
 * WHY: product default changed from `full` to `hidden`; bootstrap backfills rows
 * written under the old default without requiring users to delete their DB.
 *
 * @module bootstrap/worktree/migrate-worktree-fill-policy
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** Backfills stored `full` fill policies to `hidden` (idempotent). */
export async function migrateWorktreeFillPolicy(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('worktree_dir_rule')",
  );
  if (rows.length === 0) {
    return;
  }
  await tx.execute(
    "UPDATE worktree_dir_rule SET fill_policy = 'hidden' WHERE fill_policy = 'full'",
  );
}
