/**
 * Aggregated schema bootstrap for Novel Master SQLite databases.
 *
 * @module bootstrap/novel-master-bootstrap
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { VFS_SCHEMA_STATEMENTS } from "./vfs/vfs-schema.js";
import { KKV_SCHEMA_STATEMENTS } from "./kkv/kkv-schema.js";
import { CHAT_SCHEMA_STATEMENTS } from "./chat/chat-schema.js";
import { SESSION_FS_SCHEMA_STATEMENTS } from "./session-fs/session-fs-schema.js";
import { WORKTREE_SCHEMA_STATEMENTS } from "./worktree/worktree-schema.js";
import { SKSP_SCHEMA_STATEMENTS } from "./sksp/sksp-schema.js";
import { PROVIDER_SCHEMA_STATEMENTS } from "./provider/provider-schema.js";
import { seedBuiltinProviders } from "./provider/seed-builtin-providers.js";

/** All module DDL statements in dependency-safe execution order. */
export const NOVEL_MASTER_SCHEMA_STATEMENTS: readonly string[] = [
  ...VFS_SCHEMA_STATEMENTS,
  ...KKV_SCHEMA_STATEMENTS,
  ...CHAT_SCHEMA_STATEMENTS,
  ...SESSION_FS_SCHEMA_STATEMENTS,
  ...WORKTREE_SCHEMA_STATEMENTS,
  ...SKSP_SCHEMA_STATEMENTS,
  ...PROVIDER_SCHEMA_STATEMENTS,
];

/**
 * Ensures VFS, KKV, chat, session-fs, and worktree tables exist. Safe to call multiple times.
 *
 * @param conn - Open TDBC connection
 */
export async function bootstrapNovelMaster(conn: TdbcConnection): Promise<void> {
  await conn.transaction(async (tx) => {
    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    // Migrate: add hidden column to chat_message if it doesn't exist
    await migrateChatMessageHidden(tx);
    await seedBuiltinProviders(tx);
  });
}

/**
 * Adds the `hidden` column to `chat_message` table if it doesn't exist.
 * This migration is idempotent and safe to run multiple times.
 */
async function migrateChatMessageHidden(conn: TdbcConnection): Promise<void> {
  // Check if hidden column exists
  const rows = await conn.query("PRAGMA table_info(chat_message)");
  const hasHidden = rows.some((row) => row.name === "hidden");
  
  if (!hasHidden) {
    await conn.execute(
      "ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0"
    );
  }
}
