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
 * @module infra/db-backup/provider-table-snapshot-validate
 */

import { Result } from "@/errors/either.js";
import { Coerce } from "@/common/coerce.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { ProviderTableSnapshotError } from "./provider-table-snapshot-error.js";
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
export function validateProviderTableSnapshot(snapshot: ProviderTableSnapshot): Result<void, ProviderTableSnapshotError> {
  for (const [rowIndex, row] of snapshot.llm_provider.entries()) {
    const table: ProviderBackupTableName = "llm_provider";
    const id = Coerce.nonEmptyText(row.id);
    if (id == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_PROVIDER_ROW", { key: "error.db_backup.provider_row_id_missing", params: { row_index: rowIndex } }, { table, rowIndex }));
    }
    const protocol = Coerce.strictText(row.protocol);
    if (protocol == null || !KNOWN_PROTOCOLS.has(protocol as LlmProtocolKind)) {
      const params = { row_index: rowIndex, protocol: String(row.protocol) };
      return Result.err(new ProviderTableSnapshotError("INVALID_PROVIDER_ROW", { key: "error.db_backup.provider_row_protocol_invalid", params }, { table, rowIndex }));
    }
    if (Coerce.nonEmptyText(row.base_url) == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_PROVIDER_ROW", { key: "error.db_backup.provider_row_base_url_empty", params: { row_index: rowIndex, id } }, { table, rowIndex }));
    }
    if (Coerce.nonEmptyText(row.display_name) == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_PROVIDER_ROW", { key: "error.db_backup.provider_row_display_name_empty", params: { row_index: rowIndex, id } }, { table, rowIndex }));
    }
    if (Coerce.strictNumber(row.is_builtin) == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_PROVIDER_ROW", { key: "error.db_backup.provider_row_is_builtin_not_number", params: { row_index: rowIndex, id } }, { table, rowIndex }));
    }
    if (Coerce.strictNumber(row.created_at_ms) == null || Coerce.strictNumber(row.updated_at_ms) == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_PROVIDER_ROW", { key: "error.db_backup.provider_row_timestamp_invalid", params: { row_index: rowIndex, id } }, { table, rowIndex }));
    }
  }
  const knownProviderIds = new Set(snapshot.llm_provider.map((row) => Coerce.nonEmptyText(row.id)).filter((id): id is string => id != null));
  for (const [rowIndex, row] of snapshot.llm_saved_model.entries()) {
    const table: ProviderBackupTableName = "llm_saved_model";
    const providerId = Coerce.nonEmptyText(row.provider_id);
    if (providerId == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_SAVED_MODEL_ROW", { key: "error.db_backup.saved_model_row_provider_id_empty", params: { row_index: rowIndex } }, { table, rowIndex }));
    }
    if (!knownProviderIds.has(providerId)) {
      return Result.err(new ProviderTableSnapshotError("DANGLING_SAVED_MODEL", { key: "error.db_backup.dangling_saved_model", params: { row_index: rowIndex, provider_id: providerId } }, { table, rowIndex }));
    }
    if (Coerce.nonEmptyText(row.vendor_model_id) == null) {
      const params = { row_index: rowIndex, provider_id: providerId };
      return Result.err(new ProviderTableSnapshotError("INVALID_SAVED_MODEL_ROW", { key: "error.db_backup.saved_model_row_vendor_model_id_empty", params }, { table, rowIndex }));
    }
    if (Coerce.strictText(row.settings_json) == null) {
      const params = { row_index: rowIndex, provider_id: providerId };
      return Result.err(new ProviderTableSnapshotError("INVALID_SAVED_MODEL_ROW", { key: "error.db_backup.saved_model_row_settings_json_missing", params }, { table, rowIndex }));
    }
  }
  for (const [rowIndex, row] of snapshot.sksp_secrets.entries()) {
    const table: ProviderBackupTableName = "sksp_secrets";
    const ref = Coerce.nonEmptyText(row.ref);
    if (ref == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_SECRET_ROW", { key: "error.db_backup.secret_row_ref_missing", params: { row_index: rowIndex } }, { table, rowIndex }));
    }
    if (row.ciphertext == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_SECRET_ROW", { key: "error.db_backup.secret_row_ciphertext_missing", params: { row_index: rowIndex, ref } }, { table, rowIndex }));
    }
    if (Coerce.nonEmptyText(row.algo) == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_SECRET_ROW", { key: "error.db_backup.secret_row_algo_empty", params: { row_index: rowIndex, ref } }, { table, rowIndex }));
    }
    if (Coerce.strictNumber(row.version) == null) {
      return Result.err(new ProviderTableSnapshotError("INVALID_SECRET_ROW", { key: "error.db_backup.secret_row_version_not_number", params: { row_index: rowIndex, ref } }, { table, rowIndex }));
    }
  }
  return Result.ok(undefined);
}
