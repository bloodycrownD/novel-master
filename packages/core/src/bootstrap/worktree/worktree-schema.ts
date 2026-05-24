/**
 * Worktree configuration table DDL.
 *
 * @module bootstrap/worktree/worktree-schema
 */

/** Idempotent DDL for worktree_dir_rule and worktree_file_rule. */
export const WORKTREE_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS worktree_dir_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    rule_enabled INTEGER NOT NULL DEFAULT 1,
    sort_field TEXT NOT NULL DEFAULT 'name',
    sort_order TEXT NOT NULL DEFAULT 'asc',
    head_count INTEGER NOT NULL DEFAULT 0,
    tail_count INTEGER NOT NULL DEFAULT 0,
    fill_policy TEXT NOT NULL DEFAULT 'hidden',
    PRIMARY KEY (scope_key, logical_path)
  )`,
  `CREATE TABLE IF NOT EXISTS worktree_file_rule (
    scope_key TEXT NOT NULL,
    logical_path TEXT NOT NULL,
    inclusion_mode TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (scope_key, logical_path)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worktree_dir_scope ON worktree_dir_rule(scope_key)`,
  `CREATE INDEX IF NOT EXISTS idx_worktree_file_scope ON worktree_file_rule(scope_key)`,
];
