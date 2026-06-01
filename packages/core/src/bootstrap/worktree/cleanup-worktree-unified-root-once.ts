/**
 * **TEMPORARY** — delete after one app restart.
 *
 * Removes worktree rules whose `logical_path` is invalid after a botched
 * `/template` → `/` migration (e.g. `e/xxx.md` from SQLite substr off-by-one).
 * Does not rewrite paths; invalid rows are dropped (breaking).
 *
 * @module bootstrap/worktree/cleanup-worktree-unified-root-once
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/**
 * Deletes worktree rows that are not absolute POSIX logical paths under `/`.
 */
export async function cleanupBrokenWorktreeLogicalPathsOnce(
  conn: TdbcConnection,
): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const table of ["worktree_dir_rule", "worktree_file_rule"] as const) {
      await tx.execute(
        `DELETE FROM ${table}
         WHERE logical_path NOT LIKE '/%'
            OR logical_path LIKE 'e/%'`,
      );
    }
  });
}
