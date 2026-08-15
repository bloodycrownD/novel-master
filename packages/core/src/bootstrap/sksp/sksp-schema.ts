/**
 * SKSP secrets table DDL.
 *
 * @module bootstrap/sksp/sksp-schema
 */

export const SKSP_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sksp_secrets (
  ref TEXT NOT NULL PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  iv BLOB,
  algo TEXT NOT NULL CHECK (algo IN (
    'linux-secret-service-aes-gcm-v1',
    'macos-keychain-aes-gcm-v1',
    'android-keystore-aes-gcm-v1',
    'dpapi-v1'
  )),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_ms INTEGER NOT NULL,
  CHECK ((algo = 'dpapi-v1') OR (iv IS NOT NULL))
);`,
];
