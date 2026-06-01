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
export async function migrateWorktreeUnifiedRoot(
  conn: TdbcConnection,
): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const table of ["worktree_dir_rule", "worktree_file_rule"] as const) {
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = '/'
         WHERE scope_key = 'global' AND logical_path = '/template'`,
      );
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = substr(logical_path, length('/template'))
         WHERE scope_key = 'global' AND logical_path LIKE '/template/%'`,
      );
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = '/'
         WHERE scope_key LIKE 'project:%' AND logical_path = '/template'`,
      );
      await tx.execute(
        `UPDATE ${table}
         SET logical_path = substr(logical_path, length('/template'))
         WHERE scope_key LIKE 'project:%' AND logical_path LIKE '/template/%'`,
      );
    }
  });
}
