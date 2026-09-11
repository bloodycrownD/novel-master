/**
 * Session Run State 表 DDL。
 *
 * @module bootstrap/session-run-state/session-run-state-schema
 */

/**
 * 幂等 DDL：`session_run_state` 及按 project 级联删除索引。
 *
 * 每会话至多一行（session_id 主键），记录该会话当前/最近一次 run 的状态、
 * 流式 partial 快照与 metrics。settled 行仅保留 metrics 字段
 * （text_chars/thinking_chars/updated_at_ms 等），partial 字段清空。
 */
export const SESSION_RUN_STATE_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS session_run_state (
    session_id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'settled')),
    started_at_ms INTEGER NOT NULL,
    text_chars INTEGER NOT NULL DEFAULT 0,
    thinking_chars INTEGER NOT NULL DEFAULT 0,
    partial_text TEXT NULL,
    partial_thinking TEXT NULL,
    pending_children_json TEXT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_run_state_project
    ON session_run_state(project_id)`,
];
