/**
 * db-backup 还原阶段对 provider 三表快照做 service 级校验时抛出的错误。
 *
 * @module infra/db-backup/provider-table-snapshot-error
 */

import type { ProviderBackupTableName } from "./provider-tables.js";

/** {@link ProviderTableSnapshotError} 的判别码。 */
export type ProviderTableSnapshotErrorCode =
  | "INVALID_PROVIDER_ROW"
  | "INVALID_SAVED_MODEL_ROW"
  | "INVALID_SECRET_ROW"
  | "DANGLING_SAVED_MODEL";

/**
 * restore 前快照校验失败时抛出。携带表名与行号便于定位脏数据来源。
 *
 * 不复用 {@link Error.cause}：调用方在 db-backup 入口已经把原始 zod / 错误信息
 * 折叠进 message，这里只保留定位用的 index/table 即可。
 */
export class ProviderTableSnapshotError extends Error {
  readonly code: ProviderTableSnapshotErrorCode;
  readonly table: ProviderBackupTableName;
  readonly rowIndex: number;

  constructor(
    code: ProviderTableSnapshotErrorCode,
    message: string,
    location: { table: ProviderBackupTableName; rowIndex: number }
  ) {
    super(message);
    this.name = "ProviderTableSnapshotError";
    this.code = code;
    this.table = location.table;
    this.rowIndex = location.rowIndex;
  }
}
