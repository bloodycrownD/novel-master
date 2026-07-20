/**
 * 构造 v1.0.x 风格缺列表，用于 schema 列对齐（T-B3）集成测试。
 */

import type { TdbcConnection } from "@novel-master/core";

export const LEGACY_DB_NOW_MS = 1_700_000_000_000;

const DEFAULT_SETTINGS_JSON = JSON.stringify({
  schemaVersion: 1,
  contextWindowTokens: 128_000,
  sampling: { enabled: false },
});

/** 向 legacy llm_saved_model 写入 openai 两行测试数据。 */
export async function seedLegacySavedModelRows(conn: TdbcConnection): Promise<void> {
  await conn.execute(
    `INSERT INTO llm_provider (
      id, protocol, base_url, display_name, secret_ref, headers_json,
      is_builtin, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "openai",
      "openai",
      "https://api.openai.com/v1",
      "OpenAI",
      null,
      "{}",
      1,
      LEGACY_DB_NOW_MS,
      LEGACY_DB_NOW_MS,
    ],
  );
  await conn.execute(
    `INSERT INTO llm_saved_model (
      provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "openai",
      "gpt-4o",
      "openai/gpt-4o",
      DEFAULT_SETTINGS_JSON,
      LEGACY_DB_NOW_MS,
      LEGACY_DB_NOW_MS,
    ],
  );
  await conn.execute(
    `INSERT INTO llm_saved_model (
      provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "openai",
      "gpt-4o-mini",
      "写作专用",
      DEFAULT_SETTINGS_JSON,
      LEGACY_DB_NOW_MS,
      LEGACY_DB_NOW_MS,
    ],
  );
}

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

/** pre-C3 worktree_* 规则表（物理旧名）。 */
export async function execLegacyWorktreeRuleTables(
  conn: TdbcConnection,
): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS worktree_dir_rule (
      scope_key TEXT NOT NULL,
      logical_path TEXT NOT NULL,
      rule_enabled INTEGER NOT NULL DEFAULT 1,
      sort_field TEXT NOT NULL DEFAULT 'name',
      sort_order TEXT NOT NULL DEFAULT 'asc',
      head_count INTEGER NOT NULL DEFAULT 0,
      tail_count INTEGER NOT NULL DEFAULT 1000,
      fill_policy TEXT NOT NULL DEFAULT 'hidden',
      PRIMARY KEY (scope_key, logical_path)
    )
  `);
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS worktree_file_rule (
      scope_key TEXT NOT NULL,
      logical_path TEXT NOT NULL,
      inclusion_mode TEXT NOT NULL DEFAULT 'auto',
      PRIMARY KEY (scope_key, logical_path)
    )
  `);
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_worktree_dir_scope ON worktree_dir_rule(scope_key)`,
  );
  await conn.execute(
    `CREATE INDEX IF NOT EXISTS idx_worktree_file_scope ON worktree_file_rule(scope_key)`,
  );
}

/** 向 legacy worktree_* 写入一条 dir + file 规则（T-R4）。 */
export async function seedLegacyWorktreeRuleRows(
  conn: TdbcConnection,
  scopeKey = "project:legacy-wp",
): Promise<void> {
  await conn.execute(
    `INSERT INTO worktree_dir_rule (
      scope_key, logical_path, rule_enabled, sort_field, sort_order,
      head_count, tail_count, fill_policy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [scopeKey, "/", 1, "name", "asc", 0, 1000, "hidden"],
  );
  await conn.execute(
    `INSERT INTO worktree_file_rule (scope_key, logical_path, inclusion_mode)
     VALUES (?, ?, ?)`,
    [scopeKey, "/readme.md", "force"],
  );
}
