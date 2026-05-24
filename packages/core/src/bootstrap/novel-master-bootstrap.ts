/**
 * Aggregated schema bootstrap for Novel Master SQLite databases.
 *
 * @module bootstrap/novel-master-bootstrap
 */

import type { TdbcConnection } from "../infra/tdbc/connection.js";
import { bootstrapVfs } from "./vfs/vfs-bootstrap.js";
import { KKV_SCHEMA_STATEMENTS } from "./kkv/kkv-schema.js";
import { CHAT_SCHEMA_STATEMENTS } from "./chat/chat-schema.js";
import { SESSION_FS_SCHEMA_STATEMENTS } from "./session-fs/session-fs-schema.js";

/**
 * Ensures VFS, KKV, chat, and session-fs tables exist. Safe to call multiple times.
 *
 * @param conn - Open TDBC connection
 */
export async function bootstrapNovelMaster(conn: TdbcConnection): Promise<void> {
  await bootstrapVfs(conn);
  await conn.transaction(async (tx) => {
    for (const sql of [
      ...KKV_SCHEMA_STATEMENTS,
      ...CHAT_SCHEMA_STATEMENTS,
      ...SESSION_FS_SCHEMA_STATEMENTS,
    ]) {
      await tx.execute(sql);
    }
  });
}
