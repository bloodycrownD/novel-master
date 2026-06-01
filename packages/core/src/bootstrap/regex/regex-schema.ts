/**
 * Regex group/rule DDL (entity tables; pointer stays in KKV).
 *
 * @module bootstrap/regex/regex-schema
 */

/** `regex_group` and `regex_rule` tables with sort index and FK cascade. */
export const REGEX_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS regex_group (
  group_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS regex_rule (
  group_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  llm_replace TEXT,
  display_replace TEXT,
  start_depth INTEGER,
  end_depth INTEGER,
  scope_user INTEGER NOT NULL DEFAULT 0,
  scope_assistant INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (group_id, rule_id),
  FOREIGN KEY (group_id) REFERENCES regex_group(group_id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS idx_regex_rule_group_sort
  ON regex_rule (group_id, sort_order)`,
];
