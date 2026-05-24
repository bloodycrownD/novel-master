/**
 * KKV table DDL statements.
 *
 * @module bootstrap/kkv/kkv-schema
 */

/** Idempotent DDL for `kkv_entry`. */
export const KKV_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS kkv_entry (
    module TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (module, key)
  )`,
];
