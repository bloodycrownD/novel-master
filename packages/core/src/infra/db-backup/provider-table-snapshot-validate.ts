/**
 * db-backup 还原前对 provider 三表快照的 service 级校验。
 *
 * 设计意图：db-backup import / cloud-sync pull 这两条入口之前直接走 raw INSERT，
 * 完全绕过 service upsert。schema 层 CHECK 只能拦 protocol enum，对 display_name
 * 空字符串、saved_model FK 悬空、sksp_secrets 字段类型等都失防。这里把 service
 * upsert 路径里的运行时约束（requireNonEmptyDisplayName / protocol enum /
 * saved_model.provider_id 必须命中 provider 主键）抽出来作为统一校验入口，
 * restoreProviderTableSnapshot 在 INSERT 前先跑一遍。
 *
 * 失败走 `DB_BACKUP_*`（125001-125014）码表，替换原快照校验错误类的
 * 14 个 descriptor 构造点；表名与行号保留在 params（`table` / `row_index`）。
 *
 * @module infra/db-backup/provider-table-snapshot-validate
 */

import { Coerce } from "@/common/coerce.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderBackupTableName, ProviderTableSnapshot } from "./provider-tables.js";

/** 与 LlmProtocolKind 运行时枚举保持一致的单源。 */
const KNOWN_PROTOCOLS: ReadonlySet<LlmProtocolKind> = new Set(["openai", "anthropic", "gemini"]);

/**
 * 对即将写入主库的快照做整体校验：行级字段 + 跨表 FK 一致性。
 * 任一行非法即返回 `Err`（首错即止），调用方应在事务外先调用本函数，
 * 再决定是否进入 scrub + INSERT 流程。
 *
 * llm_provider 行与 SqliteProviderRepository.rowToProvider +
 * DefaultProviderService.requireNonEmptyDisplayName 对齐；llm_saved_model
 * 只校验两种 schema 都有的不变式（provider_id 命中、vendor_model_id /
 * settings_json 非空）；sksp_secrets 的 iv 允许 NULL，其余字段必填。
 */
export function validateProviderTableSnapshot(snapshot: ProviderTableSnapshot): Result<void, AppError> {
  for (const [rowIndex, row] of snapshot.llm_provider.entries()) {
    const table: ProviderBackupTableName = "llm_provider";
    const id = Coerce.nonEmptyText(row.id);
    if (id == null) {
      return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_ID_MISSING", { row_index: rowIndex, table }));
    }
    const protocol = Coerce.strictText(row.protocol);
    if (protocol == null || !KNOWN_PROTOCOLS.has(protocol as LlmProtocolKind)) {
      return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_PROTOCOL_INVALID", { row_index: rowIndex, protocol: String(row.protocol), table }));
    }
    if (Coerce.nonEmptyText(row.base_url) == null) {
      return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_BASE_URL_EMPTY", { row_index: rowIndex, id, table }));
    }
    if (Coerce.nonEmptyText(row.display_name) == null) {
      return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_DISPLAY_NAME_EMPTY", { row_index: rowIndex, id, table }));
    }
    if (Coerce.strictNumber(row.is_builtin) == null) {
      return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_IS_BUILTIN_NOT_NUMBER", { row_index: rowIndex, id, table }));
    }
    if (Coerce.strictNumber(row.created_at_ms) == null || Coerce.strictNumber(row.updated_at_ms) == null) {
      return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_TIMESTAMP_INVALID", { row_index: rowIndex, id, table }));
    }
  }
  const knownProviderIds = new Set(snapshot.llm_provider.map((row) => Coerce.nonEmptyText(row.id)).filter((id): id is string => id != null));
  for (const [rowIndex, row] of snapshot.llm_saved_model.entries()) {
    const table: ProviderBackupTableName = "llm_saved_model";
    const providerId = Coerce.nonEmptyText(row.provider_id);
    if (providerId == null) {
      return Result.err(new AppError("DB_BACKUP_SAVED_MODEL_ROW_PROVIDER_ID_EMPTY", { row_index: rowIndex, table }));
    }
    if (!knownProviderIds.has(providerId)) {
      return Result.err(new AppError("DB_BACKUP_DANGLING_SAVED_MODEL", { row_index: rowIndex, provider_id: providerId, table }));
    }
    if (Coerce.nonEmptyText(row.vendor_model_id) == null) {
      return Result.err(new AppError("DB_BACKUP_SAVED_MODEL_ROW_VENDOR_MODEL_ID_EMPTY", { row_index: rowIndex, provider_id: providerId, table }));
    }
    if (Coerce.strictText(row.settings_json) == null) {
      return Result.err(new AppError("DB_BACKUP_SAVED_MODEL_ROW_SETTINGS_JSON_MISSING", { row_index: rowIndex, provider_id: providerId, table }));
    }
  }
  for (const [rowIndex, row] of snapshot.sksp_secrets.entries()) {
    const table: ProviderBackupTableName = "sksp_secrets";
    const ref = Coerce.nonEmptyText(row.ref);
    if (ref == null) {
      return Result.err(new AppError("DB_BACKUP_SECRET_ROW_REF_MISSING", { row_index: rowIndex, table }));
    }
    if (row.ciphertext == null) {
      return Result.err(new AppError("DB_BACKUP_SECRET_ROW_CIPHERTEXT_MISSING", { row_index: rowIndex, ref, table }));
    }
    if (Coerce.nonEmptyText(row.algo) == null) {
      return Result.err(new AppError("DB_BACKUP_SECRET_ROW_ALGO_EMPTY", { row_index: rowIndex, ref, table }));
    }
    if (Coerce.strictNumber(row.version) == null) {
      return Result.err(new AppError("DB_BACKUP_SECRET_ROW_VERSION_NOT_NUMBER", { row_index: rowIndex, ref, table }));
    }
  }
  return Result.ok(undefined);
}
