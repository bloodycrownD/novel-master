/**
 * macOS Keychain + AES-GCM SQLite `sksp_secrets` store.
 *
 * @module sqlite-secret-store
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { SqlTemplateParser } from "@novel-master/core";
import {
  executeTemplate,
  queryTemplate,
} from "@novel-master/core/tdbc";
import type { Row } from "@novel-master/core/tdbc";
import {
  assertValidRef,
  SkspError,
  type SecretStore,
} from "@novel-master/core/sksp";
import { decryptUtf8, encryptUtf8 } from "./crypto.js";
import { getOrCreateMasterKey } from "./keychain.js";

const ALGO = "macos-keychain-aes-gcm-v1";

function rowCiphertext(row: Row): Uint8Array {
  const raw = row.ciphertext;
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (typeof raw === "string") {
    return new Uint8Array(Buffer.from(raw, "binary"));
  }
  throw new SkspError("DB_ERROR", "Invalid ciphertext column type");
}

function rowIv(row: Row, ref: string): Uint8Array {
  const raw = row.iv;
  if (raw == null) {
    throw new SkspError("DECRYPT_FAILED", `Missing IV for ${ref}`, { ref });
  }
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (typeof raw === "string") {
    return new Uint8Array(Buffer.from(raw, "binary"));
  }
  throw new SkspError("DB_ERROR", "Invalid iv column type");
}

/** Keychain-backed secret store using an open TDBC connection. */
export class MacSqliteSecretStore implements SecretStore {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(ref: string): Promise<string | null> {
    assertValidRef(ref);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ciphertext, iv, algo, version FROM sksp_secrets WHERE ref = #{ref}`,
      { ref },
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (String(row.algo) !== ALGO) {
      throw new SkspError(
        "DECRYPT_FAILED",
        `Unsupported algo for ${ref}. Re-run: nm provider edit --apiKey`,
        { ref },
      );
    }
    const masterKey = await getOrCreateMasterKey(ref, "decrypt");
    return decryptUtf8(rowCiphertext(row), rowIv(row, ref), masterKey, ref);
  }

  async has(ref: string): Promise<boolean> {
    assertValidRef(ref);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT 1 AS n FROM sksp_secrets WHERE ref = #{ref} LIMIT 1`,
      { ref },
    );
    return rows.length > 0;
  }

  async set(ref: string, plain: string): Promise<void> {
    assertValidRef(ref);
    const masterKey = await getOrCreateMasterKey(ref, "encrypt");
    const { ciphertext, iv } = encryptUtf8(plain, masterKey, ref);
    const now = Date.now();
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, version, updated_at_ms)
       VALUES (#{ref}, #{ciphertext}, #{iv}, #{algo}, 1, #{updatedAtMs})
       ON CONFLICT(ref) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         algo = excluded.algo,
         version = excluded.version,
         updated_at_ms = excluded.updated_at_ms`,
      {
        ref,
        ciphertext,
        iv,
        algo: ALGO,
        updatedAtMs: now,
      },
    );
  }

  async delete(ref: string): Promise<boolean> {
    assertValidRef(ref);
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM sksp_secrets WHERE ref = #{ref}`,
      { ref },
    );
    return result.changes > 0;
  }
}

/** Creates a macOS SQLite secret store. */
export function createMacSecretStore(conn: TdbcConnection): SecretStore {
  return new MacSqliteSecretStore(conn);
}
