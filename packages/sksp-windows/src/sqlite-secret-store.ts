/**
 * Windows DPAPI + SQLite `sksp_secrets` store。
 *
 * 重构后只保留平台 strategy 实现，SQL 编排交给
 * {@link BaseSqliteSecretStore}。DPAPI 没有 iv 概念，
 * 所以 strategy 的 iv 返回 null，DB 里也存 NULL。
 *
 * @module sqlite-secret-store
 */

import type { TdbcConnection, Row } from "@novel-master/core/tdbc";
import { BaseSqliteSecretStore, type SecretStore, type SkspCryptoStrategy } from "@novel-master/core/sksp";
import { SkspRowBinary } from "@novel-master/core/sksp-node";
import { protectUtf8, unprotectUtf8 } from "./dpapi.js";

const ALGO = "dpapi-v1";

/** Windows DPAPI 加密策略：没有 iv，固定返回 null。 */
const windowsStrategy: SkspCryptoStrategy = {
  algo: ALGO,
  async encrypt(ref, plain) {
    const ciphertext = await protectUtf8(plain, ref);
    return { ciphertext, iv: null };
  },
  async decrypt(ref, row: Row) {
    return unprotectUtf8(SkspRowBinary.ciphertext(row), ref);
  },
};

/** DPAPI-backed secret store using an open TDBC connection. */
export class SqliteSecretStore extends BaseSqliteSecretStore {
  constructor(conn: TdbcConnection) {
    super(conn, windowsStrategy);
  }
}

/** Creates a Windows SQLite secret store. */
export function createWindowsSecretStore(conn: TdbcConnection): SecretStore {
  return new SqliteSecretStore(conn);
}
