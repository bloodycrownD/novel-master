/**
 * One-time worktree logical_path migration: `/template` → unified `/` root.
 *
 * @module bootstrap/worktree/migrate-worktree-unified-root
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/**
 * Rewrites legacy worktree rules that used `/template` as logical root (breaking change).
 * Safe to run on every bootstrap; no-op when rows already use `/`.
 */
/** Repair rows corrupted by an earlier SQLite substr(..., 9) off-by-one (`/template/x` → `e/x`). */
async function repairCorruptedWorktreePaths(
  tx: TdbcConnection,
  table: "worktree_dir_rule" | "worktree_file_rule",
): Promise<void> {
  // substr(..., 2) on `e/xxx` is already `/xxx` (SQLite 1-based index at `/`).
  await tx.execute(
    `UPDATE ${table}
     SET logical_path = substr(logical_path, 2)
     WHERE logical_path LIKE 'e/%'`,
  );
  await tx.execute(
    `UPDATE ${table}
     SET logical_path = '/' || logical_path
     WHERE logical_path NOT LIKE '/%' AND length(logical_path) > 0`,
  );
}

export async function migrateWorktreeUnifiedRoot(
  conn: TdbcConnection,
): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const table of ["worktree_dir_rule", "worktree_file_rule"] as const) {
      await repairCorruptedWorktreePaths(tx, table);
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = '/'
         WHERE scope_key = 'global' AND logical_path = '/template'`,
      );
      // SQLite substr is 1-based; skip the "/template" prefix (9 chars) via start index 10.
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = substr(logical_path, length('/template') + 1)
         WHERE scope_key = 'global' AND logical_path LIKE '/template/%'`,
      );
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = '/'
         WHERE scope_key LIKE 'project:%' AND logical_path = '/template'`,
      );
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = substr(logical_path, length('/template') + 1)
         WHERE scope_key LIKE 'project:%' AND logical_path LIKE '/template/%'`,
      );
    }
  });
}
