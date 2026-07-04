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
  `CREATE TABLE IF NOT EXISTS llm_saved_model (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  vendor_model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES llm_provider(id) ON DELETE CASCADE
);`,
  `CREATE INDEX IF NOT EXISTS idx_llm_saved_model_provider
    ON llm_saved_model(provider_id);`,
];
