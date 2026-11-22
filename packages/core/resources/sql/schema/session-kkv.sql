-- Session KKV 表 DDL。

CREATE TABLE IF NOT EXISTS session_kkv_entry (
    session_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (session_id, domain, key)
  );

CREATE INDEX IF NOT EXISTS idx_session_kkv_session ON session_kkv_entry(session_id);
