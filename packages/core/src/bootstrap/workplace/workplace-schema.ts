/**
 * Workplace configuration table DDL.
 *
 * @module bootstrap/workplace/workplace-schema
 */

/** Canonical table: directory inclusion rules. */
export const WORKPLACE_DIR_RULE_TABLE = "workplace_dir_rule";
/** Canonical table: file inclusion rules. */
export const WORKPLACE_FILE_RULE_TABLE = "workplace_file_rule";
/** Canonical index on dir rules by scope. */
export const WORKPLACE_DIR_SCOPE_INDEX = "idx_workplace_dir_scope";
/** Canonical index on file rules by scope. */
export const WORKPLACE_FILE_SCOPE_INDEX = "idx_workplace_file_scope";

/** Idempotent DDL for workplace dir/file rules. */
export const WORKPLACE_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${WORKPLACE_DIR_RULE_TABLE} (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    rule_enabled INTEGER NOT NULL DEFAULT 1,
    sort_field TEXT NOT NULL DEFAULT 'name',
    sort_order TEXT NOT NULL DEFAULT 'asc',
    head_count INTEGER NOT NULL DEFAULT 0,
    tail_count INTEGER NOT NULL DEFAULT 1000,
    fill_policy TEXT NOT NULL DEFAULT 'hidden',
    PRIMARY KEY (scope_key, logical_path)
  )`,
  `CREATE TABLE IF NOT EXISTS ${WORKPLACE_FILE_RULE_TABLE} (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    inclusion_mode TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (scope_key, logical_path)
  )`,
  `CREATE INDEX IF NOT EXISTS ${WORKPLACE_DIR_SCOPE_INDEX} ON ${WORKPLACE_DIR_RULE_TABLE}(scope_key)`,
  `CREATE INDEX IF NOT EXISTS ${WORKPLACE_FILE_SCOPE_INDEX} ON ${WORKPLACE_FILE_RULE_TABLE}(scope_key)`,
];
