/**
 * 数据库备份中需排除/保留的服务商相关表定义。
 *
 * @module infra/db-backup/provider-tables
 */

import type { Row } from "../tdbc/types.js";

/** 导出备份时需清除、导入时需保留的三张服务商表（顺序与 DDL 无关）。 */
export const DB_BACKUP_PROVIDER_TABLES = [
  "sksp_secrets",
  "llm_provider",
  "llm_saved_model",
] as const;

/** {@link DB_BACKUP_PROVIDER_TABLES} 中的表名。 */
export type ProviderBackupTableName = (typeof DB_BACKUP_PROVIDER_TABLES)[number];

/**
 * 三张服务商表的行级快照，用于导入前 dump 与导入后 restore。
 */
export type ProviderTableSnapshot = {
  readonly [K in ProviderBackupTableName]: Row[];
};
