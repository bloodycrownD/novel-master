/**
 * VFS schema bootstrap: idempotent DDL on an open TDBC connection.
 *
 * @module bootstrap/vfs/vfs-bootstrap
 */

import type { TdbcConnection } from "../../infra/tdbc/connection.js";
import { VFS_SCHEMA_STATEMENTS } from "./vfs-schema.js";

/**
 * Ensures VFS tables and indexes exist. Safe to call multiple times.
 *
 * @param conn - Open TDBC connection (caller registers driver and opens URL)
 */
export async function bootstrapVfs(conn: TdbcConnection): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const sql of VFS_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
  });
}
