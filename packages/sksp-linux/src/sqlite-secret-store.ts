/**
 * Linux Secret Service + AES-GCM SQLite `sksp_secrets` store。
 *
 * 重构后只保留平台 strategy 实现，SQL 编排交给
 * {@link BaseSqliteSecretStore}。
 *
 * @module sqlite-secret-store
 */

import type { TdbcConnection, Row } from "@novel-master/core/tdbc";
import {
  BaseSqliteSecretStore,
  SkspError,
  type SecretStore,
  type SkspCryptoStrategy,
} from "@novel-master/core/sksp";
import { decryptUtf8, encryptUtf8 } from "./crypto.js";
import { getOrCreateMasterKey } from "./keychain.js";

const ALGO = "linux-secret-service-aes-gcm-v1";

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

/** Linux Secret Service 加密策略：ciphertext/iv 都是 Uint8Array。 */
const linuxStrategy: SkspCryptoStrategy = {
  algo: ALGO,
  async encrypt(ref, plain) {
    const masterKey = await getOrCreateMasterKey(ref, "encrypt");
    return encryptUtf8(plain, masterKey, ref);
  },
  async decrypt(ref, row: Row) {
    const masterKey = await getOrCreateMasterKey(ref, "decrypt");
    return decryptUtf8(rowCiphertext(row), rowIv(row, ref), masterKey, ref);
  },
};

/** Secret Service-backed secret store using an open TDBC connection. */
export class LinuxSqliteSecretStore extends BaseSqliteSecretStore {
  constructor(conn: TdbcConnection) {
    super(conn, linuxStrategy);
  }
}

/** Creates a Linux SQLite secret store. */
export function createLinuxSecretStore(conn: TdbcConnection): SecretStore {
  return new LinuxSqliteSecretStore(conn);
}
