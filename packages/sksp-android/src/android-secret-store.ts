/**
 * Android Keystore + SQLite `sksp_secrets` store.
 *
 * @module android-secret-store
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { SqlTemplateParser } from "@novel-master/core";
import {
  executeTemplate,
  queryTemplate,
} from "@novel-master/core/tdbc";
import {
  assertValidRef,
  SkspError,
  type SecretStore,
} from "@novel-master/core/sksp";
import { getSkspNativeModule } from "./native.js";

const ALGO = "android-keystore-aes-gcm-v1";

function decodeBlob(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "string") {
    return base64ToBytes(value);
  }
  throw new SkspError("DB_ERROR", "Invalid blob column");
}

function encodeBlob(bytes: Uint8Array): Uint8Array {
  return bytes;
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Android SKSP store backed by Keystore and `sksp_secrets`. */
export class AndroidSecretStore implements SecretStore {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async get(ref: string): Promise<string | null> {
    assertValidRef(ref);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ciphertext, iv, algo FROM sksp_secrets WHERE ref = #{ref}`,
      { ref },
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (String(row.algo) !== ALGO) {
      throw new SkspError(
        "DECRYPT_FAILED",
        `Unsupported algo for ${ref}. Re-configure apiKey on this device.`,
        { ref },
      );
    }
    const iv = row.iv;
    if (iv == null) {
      throw new SkspError("DECRYPT_FAILED", `Missing IV for ${ref}`, { ref });
    }
    const native = getSkspNativeModule();
    try {
      const plain = await native.decrypt(
        ref,
        bytesToBase64(decodeBlob(row.ciphertext)),
        bytesToBase64(decodeBlob(iv)),
      );
      return plain;
    } catch (cause) {
      throw new SkspError(
        "DECRYPT_FAILED",
        `Keystore decrypt failed for ${ref}. Re-configure apiKey.`,
        { ref, cause },
      );
    }
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
    const native = getSkspNativeModule();
    let enc: { ciphertext: string; iv: string };
    try {
      enc = await native.encrypt(ref, plain);
    } catch (cause) {
      throw new SkspError("ENCRYPT_FAILED", `Keystore encrypt failed for ${ref}`, {
        ref,
        cause,
      });
    }
    const ciphertext = encodeBlob(base64ToBytes(enc.ciphertext));
    const iv = encodeBlob(base64ToBytes(enc.iv));
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

/** Creates an Android secret store for an open connection. */
export function createAndroidSecretStore(conn: TdbcConnection): SecretStore {
  return new AndroidSecretStore(conn);
}
