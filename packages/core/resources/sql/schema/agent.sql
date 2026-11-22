-- Agent definition SQLite DDL.

CREATE TABLE IF NOT EXISTS agent_definition (
    agent_id TEXT NOT NULL PRIMARY KEY,
    prompts_json TEXT NOT NULL CHECK (prompts_json IS NULL OR json_valid(prompts_json)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );
