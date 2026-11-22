-- KKV table DDL statements.

CREATE TABLE IF NOT EXISTS kkv_entry (
    module TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (module, key)
  );
