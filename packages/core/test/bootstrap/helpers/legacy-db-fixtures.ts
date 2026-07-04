/**
 * 构造 v1.0.x 风格缺列表，用于 schema 列对齐（T-B3）集成测试。
 */

import type { TdbcConnection } from "@novel-master/core";

/** v1.0.7 风格 chat_session（无 user_vfs_pending_json）。 */
export async function execLegacyV107ChatDdl(conn: TdbcConnection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS chat_session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);
  await conn.execute(`
    CREATE INDEX IF NOT EXISTS idx_chat_session_project
      ON chat_session(project_id)
  `);
}

/** v1.0.7 风格 chat_message（无 hidden）。 */
export async function execLegacyChatMessageWithoutHidden(
  conn: TdbcConnection,
): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS chat_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      provider TEXT,
      raw_json TEXT,
      created_at_ms INTEGER NOT NULL,
      UNIQUE (session_id, seq)
    )
  `);
}

/** 旧 vfs_entry（无 entry_kind / head_version）。 */
export async function execLegacyVfsEntryTable(conn: TdbcConnection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS vfs_entry (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      mtime_ms INTEGER NOT NULL,
      storage_kind TEXT NOT NULL DEFAULT 'inline',
      external_uri TEXT
    )
  `);
  await conn.execute(`
    CREATE INDEX IF NOT EXISTS idx_vfs_entry_path_prefix ON vfs_entry(path)
  `);
}

/** legacy llm_saved_model（复合主键，无 id / model_name）。 */
export async function execLegacySavedModelTable(conn: TdbcConnection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS llm_provider (
      id TEXT PRIMARY KEY,
      protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
      base_url TEXT NOT NULL,
      display_name TEXT,
      secret_ref TEXT,
      headers_json TEXT NOT NULL DEFAULT '{}',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS llm_saved_model (
      provider_id TEXT NOT NULL,
      vendor_model_id TEXT NOT NULL,
      display_name TEXT,
      settings_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (provider_id, vendor_model_id),
      FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
    )
  `);
}
