/**
 * macOS Keychain + AES-GCM SQLite `sksp_secrets` store。
 *
 * SQL 编排交给 {@link BaseSqliteSecretStore}，AES-GCM 策略交给 core 的
 * {@link createAesGcmStrategy}；这里只声明平台的 algo 与主密钥来源。
 *
 * @module sqlite-secret-store
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { BaseSqliteSecretStore, type SecretStore } from "@novel-master/core/sksp";
import { createAesGcmStrategy } from "@novel-master/core/sksp-node";
import { getOrCreateMasterKey } from "./keychain.js";

const ALGO = "macos-keychain-aes-gcm-v1";
const macStrategy = createAesGcmStrategy({ algo: ALGO, masterKey: getOrCreateMasterKey });

/** Keychain-backed secret store using an open TDBC connection. */
export class MacSqliteSecretStore extends BaseSqliteSecretStore {
  constructor(conn: TdbcConnection) {
    super(conn, macStrategy);
  }
}

/** Creates a macOS SQLite secret store. */
export function createMacSecretStore(conn: TdbcConnection): SecretStore {
  return new MacSqliteSecretStore(conn);
}
