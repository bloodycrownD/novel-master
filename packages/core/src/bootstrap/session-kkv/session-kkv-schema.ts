/**
 * Session KKV 表 DDL。
 *
 * @module bootstrap/session-kkv/session-kkv-schema
 */

/** 幂等 DDL：`session_kkv_entry` 及按 session 查询索引。 */
export const SESSION_KKV_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS session_kkv_entry (
    session_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (session_id, domain, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_kkv_session ON session_kkv_entry(session_id)`,
];
