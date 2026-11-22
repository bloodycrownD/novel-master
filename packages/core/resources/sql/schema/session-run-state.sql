-- Session Run State 表 DDL。

CREATE TABLE IF NOT EXISTS session_run_state (
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
  );

CREATE INDEX IF NOT EXISTS idx_session_run_state_project
    ON session_run_state(project_id);
