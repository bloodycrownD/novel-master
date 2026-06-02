/**
 * LLM provider / model DDL.
 *
 * @module bootstrap/provider/provider-schema
 */

export const PROVIDER_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS llm_provider (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'gemini')),
  base_url TEXT NOT NULL,
  display_name TEXT,
  secret_ref TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS llm_model_suggestion (
  provider_id TEXT NOT NULL,
  vendor_model_id TEXT NOT NULL,
  display_name TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  last_seen_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_id, vendor_model_id),
  FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
);`,
  `CREATE TABLE IF NOT EXISTS llm_saved_model (
  provider_id TEXT NOT NULL,
  vendor_model_id TEXT NOT NULL,
  display_name TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_id, vendor_model_id),
  FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
);`,
];
