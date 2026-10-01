/**
 * Chat tables DDL (project, session, message).
 *
 * @module bootstrap/chat/chat-schema
 */

/** Idempotent DDL for chat entities. */
export const CHAT_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS chat_project (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    agent_config_json TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_session (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    composer_draft_json TEXT NULL,
    agent_config_json TEXT NULL,
    parent_session_id TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_session_project
    ON chat_session(project_id)`,
  `CREATE TABLE IF NOT EXISTS chat_message (
    id TEXT NOT NULL PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content_json TEXT NOT NULL,
    provider TEXT,
    provider_id TEXT NULL,
    raw_json TEXT,
    created_at_ms INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    attachments_json TEXT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    cache_read_tokens INTEGER NULL,
    cache_creation_tokens INTEGER NULL,
    model_name TEXT NULL,
    first_token_ms INTEGER NULL,
    duration_ms INTEGER NULL,
    -- 消息正文存储（明文为正形态）：写侧直写 content_json，两列恒 NULL；
    -- 两列仅迁移期存量压缩行为非 NULL——读路径双形态保留至 V1'（压缩行按
    -- content_encoding 解压，否则 parse 明文），content_blob 非空 → 解压，
    -- 否则 parse content_json。CHECK 对 NULL 放行（写法对齐
    -- vfs_content_blob.encoding 先例）——legacy 明文行两列皆 NULL，永远合法，
    -- 这是迁移可中断、e2e fixture 直插明文仍可用的地基。
    content_encoding TEXT NULL CHECK (content_encoding IN ('zlib', 'zlib-b64')),
    content_blob BLOB NULL,
    UNIQUE (session_id, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_message_created_at
    ON chat_message(created_at_ms)`,
];
