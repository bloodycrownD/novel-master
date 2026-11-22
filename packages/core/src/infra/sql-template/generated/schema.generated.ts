/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/schema/*.sql 生成，勿手改。
 * 每个域一个 .sql 文件（幂等 DDL，分号分隔），装配方逐条 tx.execute；
 * 空数组域（session-fs）不产文件、导出随消费点退役。
 *
 * @module infra/sql-template/generated
 */

/** agent.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const AGENT_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS agent_definition (
    agent_id TEXT NOT NULL PRIMARY KEY,
    prompts_json TEXT NOT NULL CHECK (prompts_json IS NULL OR json_valid(prompts_json)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`,
] as const;

/** chat.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const CHAT_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS chat_project (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    agent_config_json TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`,
    `CREATE TABLE IF NOT EXISTS chat_session (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    composer_draft_json TEXT NULL,
    agent_config_json TEXT NULL,
    parent_session_id TEXT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_chat_session_project
    ON chat_session(project_id)
`,
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
    -- 消息正文存储（明文为正形态）：写侧直写 content_json，两列恒 NULL。
    -- 两列仅作为历史列保留（存量压缩行的痕迹），读路径只认 content_json。
    -- CHECK 对 NULL 放行（写法对齐 vfs_content_blob.encoding 先例）——
    -- legacy 明文行两列皆 NULL，永远合法，这是迁移可中断、e2e fixture 直插
    -- 明文仍可用的地基。
    content_encoding TEXT NULL CHECK (content_encoding IN ('zlib', 'zlib-b64')),
    content_blob BLOB NULL,
    UNIQUE (session_id, seq)
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_chat_message_created_at
    ON chat_message(created_at_ms)
`,
] as const;

/** file-cache.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const FILE_CACHE_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS session_file_cache_blob (
    content_hash TEXT NOT NULL PRIMARY KEY,
    encoding TEXT NOT NULL CHECK (encoding IN ('zlib', 'zlib-b64')),
    bytes BLOB NOT NULL,
    byte_len INTEGER NOT NULL
  ) WITHOUT ROWID
`,
    `CREATE TABLE IF NOT EXISTS session_file_cache_entry (
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, key)
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_session_file_cache_hash
    ON session_file_cache_entry(content_hash)
`,
] as const;

/** kkv.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const KKV_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS kkv_entry (
    module TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (module, key)
  )
`,
] as const;

/** message-checkpoint.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const MESSAGE_CHECKPOINT_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS message_checkpoint (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, message_id)
) WITHOUT ROWID
`,
    `CREATE TABLE IF NOT EXISTS message_checkpoint_file (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  revision_version INTEGER NOT NULL CHECK (revision_version >= 1),
  path TEXT NULL,
  PRIMARY KEY (session_id, message_id, entry_id)
) WITHOUT ROWID
`,
] as const;

/** provider.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const PROVIDER_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS llm_provider (
  id TEXT NOT NULL PRIMARY KEY,
  builtin_key TEXT UNIQUE,
  protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
  base_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  secret_ref TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  body_params_json TEXT NOT NULL DEFAULT '{}',
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)
`,
    `CREATE TABLE IF NOT EXISTS llm_saved_model (
  id TEXT NOT NULL PRIMARY KEY,
  provider_id TEXT NOT NULL,
  vendor_model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  settings_json TEXT NOT NULL CHECK (settings_json IS NULL OR json_valid(settings_json)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
)
`,
    `CREATE INDEX IF NOT EXISTS idx_llm_saved_model_provider
    ON llm_saved_model(provider_id)
`,
] as const;

/** session-kkv.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const SESSION_KKV_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS session_kkv_entry (
    session_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (session_id, domain, key)
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_session_kkv_session ON session_kkv_entry(session_id)
`,
] as const;

/** session-run-state.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const SESSION_RUN_STATE_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS session_run_state (
    session_id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'settled')),
    started_at_ms INTEGER NOT NULL,
    text_chars INTEGER NOT NULL DEFAULT 0,
    thinking_chars INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    token_source TEXT NOT NULL DEFAULT 'heuristic',
    partial_text TEXT NULL,
    partial_thinking TEXT NULL,
    pending_children_json TEXT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_session_run_state_project
    ON session_run_state(project_id)
`,
] as const;

/** skills.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const SKILLS_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS skill_disabled_rule (
    -- 域键：当前约定为 project:{pid}，全局域预留
    scope_key TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    PRIMARY KEY (scope_key, skill_name)
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_skill_disabled_scope ON skill_disabled_rule(scope_key)
`,
] as const;

/** sksp.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const SKSP_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS sksp_secrets (
  ref TEXT NOT NULL PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  iv BLOB,
  algo TEXT NOT NULL CHECK (algo IN (
    'linux-secret-service-aes-gcm-v1',
    'macos-keychain-aes-gcm-v1',
    'android-keystore-aes-gcm-v1',
    'dpapi-v1'
  )),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL,
  CHECK ((algo = 'dpapi-v1') OR (iv IS NOT NULL))
)
`,
] as const;

/** smart-sort-rule.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const SMART_SORT_RULE_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS smart_sort_rule (
    rule_id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
    capture_kind TEXT NOT NULL DEFAULT 'smart' CHECK (capture_kind IN ('smart', 'fixed_min', 'fixed_max')),
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_smart_sort_rule_order ON smart_sort_rule(sort_order)
`,
] as const;

/** usage-record.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const USAGE_RECORD_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS usage_record (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 溯源：产生本请求的会话（可空；不设外键，会话删除后本行保留）
    session_id TEXT NULL,
    -- 溯源：本请求对应的 assistant 消息在会话内的 seq（供会话详情弹窗）
    message_seq INTEGER NULL,
    -- 协议快照（anthropic/openai/gemini）：命中率分母的 anthropic 加法项依据
    provider TEXT NULL,
    -- 服务商配置 id 快照（写入时记，服务商删除/改名不回写历史行）
    provider_id TEXT NULL,
    model_name TEXT NULL,
    prompt_tokens INTEGER NULL,
    completion_tokens INTEGER NULL,
    total_tokens INTEGER NULL,
    cache_read_tokens INTEGER NULL,
    cache_creation_tokens INTEGER NULL,
    first_token_ms INTEGER NULL,
    duration_ms INTEGER NULL,
    -- 请求完成落库时刻（统计时间轴与桶归属依据）
    created_at_ms INTEGER NOT NULL
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_usage_record_created_at
    ON usage_record(created_at_ms)
`,
    `CREATE INDEX IF NOT EXISTS idx_usage_record_session
    ON usage_record(session_id)
`,
] as const;

/** vfs-content-blob.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const VFS_CONTENT_BLOB_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS vfs_content_blob (
  content_hash TEXT NOT NULL PRIMARY KEY,
  encoding TEXT NOT NULL CHECK (encoding IN ('zlib', 'zlib-b64')),
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0)
) WITHOUT ROWID
`,
] as const;

/** vfs-content-pack.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const VFS_CONTENT_PACK_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS vfs_content_pack (
  pack_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('zlib-concat-v1','fossil-chain-v1')),
  bytes BLOB NOT NULL,
  byte_len INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
)
`,
    `CREATE TABLE IF NOT EXISTS vfs_content_pack_member (
  content_hash TEXT NOT NULL PRIMARY KEY,
  pack_id INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  length INTEGER NOT NULL,
  compressed_byte_len INTEGER NOT NULL
) WITHOUT ROWID
`,
    `CREATE INDEX IF NOT EXISTS idx_vfs_content_pack_member_pack
  ON vfs_content_pack_member(pack_id)
`,
] as const;

/** vfs-revision.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const VFS_REVISION_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS vfs_revision (
  entry_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  mtime_ms INTEGER NOT NULL,
  content_hash TEXT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  PRIMARY KEY (entry_id, version),
  CHECK (NOT (status = 'active' AND content_hash IS NULL))
) WITHOUT ROWID
`,
    `CREATE TRIGGER IF NOT EXISTS trg_revision_insert_inc_blob_ref
AFTER INSERT ON vfs_revision
WHEN NEW.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash;
END;
`,
    `DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref
`,
    `DROP TRIGGER IF EXISTS trg_revision_update_transfer_blob_ref
`,
    `DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref_v2
`,
    `DROP TRIGGER IF EXISTS trg_revision_update_transfer_blob_ref_v2
`,
    `CREATE TRIGGER trg_revision_delete_dec_blob_ref_v2
AFTER DELETE ON vfs_revision
WHEN OLD.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob
  SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0
    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
END;
`,
    `CREATE TRIGGER trg_revision_update_transfer_blob_ref_v2
AFTER UPDATE OF content_hash ON vfs_revision
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash AND OLD.content_hash IS NOT NULL;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash AND NEW.content_hash IS NOT NULL;
END;
`,
    `CREATE INDEX IF NOT EXISTS idx_vfs_entry_content_hash
  ON vfs_entry(content_hash) WHERE content_hash IS NOT NULL
`,
] as const;

/** vfs.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const VFS_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS vfs_entry (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NULL,
  head_version INTEGER NOT NULL DEFAULT 1,
  mtime_ms INTEGER NOT NULL,
  entry_kind TEXT NOT NULL DEFAULT 'file' CHECK (entry_kind IN ('file', 'directory')),
  content TEXT NULL,
  UNIQUE(scope_key, path)
)
`,
] as const;

/** workplace.sql 的幂等 DDL 语句序列（执行顺序 = 文件内顺序）。 */
export const WORKPLACE_SCHEMA_STATEMENTS: readonly string[] = [
    `CREATE TABLE IF NOT EXISTS workplace_dir_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    rule_enabled INTEGER NOT NULL DEFAULT 1 CHECK (rule_enabled IN (0, 1)),
    sort_field TEXT NOT NULL DEFAULT 'name' CHECK (sort_field IN ('name', 'created', 'updated', 'smart')),
    sort_order TEXT NOT NULL DEFAULT 'asc' CHECK (sort_order IN ('asc', 'desc')),
    head_count INTEGER NOT NULL DEFAULT 0 CHECK (head_count >= 0),
    tail_count INTEGER NOT NULL DEFAULT 1000 CHECK (tail_count >= 0),
    fill_policy TEXT NOT NULL DEFAULT 'header' CHECK (fill_policy IN ('hidden', 'filename', 'header', 'full')),
    PRIMARY KEY (scope_key, logical_path)
  )
`,
    `CREATE TABLE IF NOT EXISTS workplace_file_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    inclusion_mode TEXT NOT NULL DEFAULT 'auto' CHECK (inclusion_mode IN ('auto', 'show', 'hide')),
    PRIMARY KEY (scope_key, logical_path)
  )
`,
    `CREATE INDEX IF NOT EXISTS idx_workplace_dir_scope ON workplace_dir_rule(scope_key)
`,
    `CREATE INDEX IF NOT EXISTS idx_workplace_file_scope ON workplace_file_rule(scope_key)
`,
] as const;
