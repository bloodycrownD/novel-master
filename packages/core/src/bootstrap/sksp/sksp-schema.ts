/**
 * SKSP secrets table DDL.
 *
 * @module bootstrap/sksp/sksp-schema
 */

export const SKSP_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sksp_secrets (
  ref TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  iv BLOB,
  algo TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL
);`,
];
