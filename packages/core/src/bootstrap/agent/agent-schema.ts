/**
 * Agent definition SQLite DDL.
 *
 * @module bootstrap/agent/agent-schema
 */

/** DDL for workspace agent registry. */
export const AGENT_SCHEMA_STATEMENTS: readonly string[] = [
  // `model` / `runtime_json` are legacy columns; repository writes only `prompts_json`.
  `CREATE TABLE IF NOT EXISTS agent_definition (
    agent_id TEXT PRIMARY KEY,
    model TEXT,
    runtime_json TEXT,
    prompts_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
];
