/**
 * Linux Secret Service + AES-GCM SQLite `sksp_secrets` store。
 *
 * SQL 编排交给 {@link BaseSqliteSecretStore}，AES-GCM 策略交给 core 的
 * {@link SkspNodeFactory.createAesGcmStrategy}；这里只声明平台的 algo 与主密钥来源。
 *
 * @module sqlite-secret-store
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { BaseSqliteSecretStore, type SecretStore } from "@novel-master/core/sksp";
import { SkspNodeFactory } from "@novel-master/core/sksp-node";
import { getOrCreateMasterKey } from "./keychain.js";

const ALGO = "linux-secret-service-aes-gcm-v1";
const linuxStrategy = SkspNodeFactory.createAesGcmStrategy({ algo: ALGO, masterKey: getOrCreateMasterKey });

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
