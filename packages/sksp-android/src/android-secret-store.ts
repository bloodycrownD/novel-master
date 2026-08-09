/**
 * Android Keystore + SQLite `sksp_secrets` store。
 *
 * 重构后只保留平台 strategy 实现，SQL 编排交给
 * {@link BaseSqliteSecretStore}。Keystore 密文走 base64 文本存储
 * （quick-sqlite heap 损伤 workaround），所以 strategy 返回的
 * ciphertext/iv 是 string 而不是 Uint8Array。
 *
 * @module android-secret-store
 */

import type { TdbcConnection, Row } from "@novel-master/core/tdbc";
import {
  BaseSqliteSecretStore,
  SkspError,
  type SecretStore,
  type SkspCryptoStrategy,
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

/** Android Keystore 加密策略：密文/iv 都以 base64 文本存进 DB。 */
const androidStrategy: SkspCryptoStrategy = {
  algo: ALGO,
  async encrypt(ref, plain) {
    const native = getSkspNativeModule();
    try {
      const enc = await native.encrypt(ref, plain);
      // 存 base64 文本，不走 Uint8Array BLOB 绑定（quick-sqlite heap 损伤）。
      return { ciphertext: enc.ciphertext, iv: enc.iv };
    } catch (cause) {
      throw new SkspError(
        "ENCRYPT_FAILED",
        `Keystore encrypt failed for ${ref}`,
        { ref, cause },
      );
    }
  },
  async decrypt(ref, row: Row) {
    const iv = row.iv;
    if (iv == null) {
      throw new SkspError("DECRYPT_FAILED", `Missing IV for ${ref}`, { ref });
    }
    const native = getSkspNativeModule();
    try {
      return await native.decrypt(
        ref,
        bytesToBase64(decodeBlob(row.ciphertext)),
        bytesToBase64(decodeBlob(iv)),
      );
    } catch (cause) {
      throw new SkspError(
        "DECRYPT_FAILED",
        `Keystore decrypt failed for ${ref}. Re-configure apiKey.`,
        { ref, cause },
      );
    }
  },
};

/** Android SKSP store backed by Keystore and `sksp_secrets`. */
export class AndroidSecretStore extends BaseSqliteSecretStore {
  constructor(conn: TdbcConnection) {
    super(conn, androidStrategy);
  }
}

/** Creates an Android secret store for an open connection. */
export function createAndroidSecretStore(conn: TdbcConnection): SecretStore {
  return new AndroidSecretStore(conn);
}
