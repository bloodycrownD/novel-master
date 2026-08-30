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

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { Row } from "../tdbc/types.js";
import { ProviderTableSnapshotError } from "./provider-table-snapshot-error.js";
import type {
  ProviderBackupTableName,
  ProviderTableSnapshot,
} from "./provider-tables.js";

/** 与 LlmProtocolKind 运行时枚举保持一致的单源。 */
const KNOWN_PROTOCOLS: ReadonlySet<LlmProtocolKind> = new Set([
  "openai",
  "anthropic",
  "gemini",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  const str = asString(value);
  return str != null && str.trim() !== "" ? str : null;
}

/**
 * 校验单行 llm_provider：与 SqliteProviderRepository.rowToProvider +
 * DefaultProviderService.requireNonEmptyDisplayName 对齐。
 */
function validateProviderRow(row: Row, rowIndex: number): void {
  const table: ProviderBackupTableName = "llm_provider";
  const id = nonEmptyString(row.id);
  if (id == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_PROVIDER_ROW",
      `llm_provider 第 ${rowIndex} 行缺少非空 id`,
      { table, rowIndex }
    );
  }
  const protocol = asString(row.protocol);
  if (protocol == null || !KNOWN_PROTOCOLS.has(protocol as LlmProtocolKind)) {
    throw new ProviderTableSnapshotError(
      "INVALID_PROVIDER_ROW",
      `llm_provider 第 ${rowIndex} 行 protocol 非法：${String(row.protocol)}`,
      { table, rowIndex }
    );
  }
  if (nonEmptyString(row.base_url) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_PROVIDER_ROW",
      `llm_provider 第 ${rowIndex} 行 base_url 为空（id=${id}）`,
      { table, rowIndex }
    );
  }
  if (nonEmptyString(row.display_name) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_PROVIDER_ROW",
      `llm_provider 第 ${rowIndex} 行 display_name 为空（id=${id}）`,
      { table, rowIndex }
    );
  }
  if (asNumber(row.is_builtin) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_PROVIDER_ROW",
      `llm_provider 第 ${rowIndex} 行 is_builtin 不是数字（id=${id}）`,
      { table, rowIndex }
    );
  }
  if (
    asNumber(row.created_at_ms) == null ||
    asNumber(row.updated_at_ms) == null
  ) {
    throw new ProviderTableSnapshotError(
      "INVALID_PROVIDER_ROW",
      `llm_provider 第 ${rowIndex} 行时间戳缺失或非数字（id=${id}）`,
      { table, rowIndex }
    );
  }
}

/**
 * 校验单行 llm_saved_model：必填字段 + provider_id 必须能在快照内命中
 * （schema 层 FK 约束在 INSERT 时由 SQLite 强制，但显式校验能给出更早、
 * 更精确的错误位置，避免被事务回滚掩盖）。
 *
 * id / model_name 仅在新 schema 下存在；legacy 表用 (provider_id, vendor_model_id)
 * 作复合主键且用 display_name 表示名称。因此这里只校验两种 schema 都有的
 * 不变式：provider_id 命中、vendor_model_id / settings_json 非空。
 */
function validateSavedModelRow(
  row: Row,
  rowIndex: number,
  knownProviderIds: ReadonlySet<string>
): void {
  const table: ProviderBackupTableName = "llm_saved_model";
  const providerId = nonEmptyString(row.provider_id);
  if (providerId == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SAVED_MODEL_ROW",
      `llm_saved_model 第 ${rowIndex} 行 provider_id 为空`,
      { table, rowIndex }
    );
  }
  if (!knownProviderIds.has(providerId)) {
    throw new ProviderTableSnapshotError(
      "DANGLING_SAVED_MODEL",
      `llm_saved_model 第 ${rowIndex} 行 provider_id=${providerId} 在快照内找不到对应 llm_provider`,
      { table, rowIndex }
    );
  }
  if (nonEmptyString(row.vendor_model_id) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SAVED_MODEL_ROW",
      `llm_saved_model 第 ${rowIndex} 行 vendor_model_id 为空（provider_id=${providerId}）`,
      { table, rowIndex }
    );
  }
  if (asString(row.settings_json) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SAVED_MODEL_ROW",
      `llm_saved_model 第 ${rowIndex} 行 settings_json 缺失（provider_id=${providerId}）`,
      { table, rowIndex }
    );
  }
}

/** 校验单行 sksp_secrets：与 sksp schema 对齐（iv 允许 NULL，其余字段必填）。 */
function validateSecretRow(row: Row, rowIndex: number): void {
  const table: ProviderBackupTableName = "sksp_secrets";
  const ref = nonEmptyString(row.ref);
  if (ref == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SECRET_ROW",
      `sksp_secrets 第 ${rowIndex} 行缺少非空 ref`,
      { table, rowIndex }
    );
  }
  if (row.ciphertext == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SECRET_ROW",
      `sksp_secrets 第 ${rowIndex} 行 ciphertext 缺失（ref=${ref}）`,
      { table, rowIndex }
    );
  }
  if (nonEmptyString(row.algo) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SECRET_ROW",
      `sksp_secrets 第 ${rowIndex} 行 algo 为空（ref=${ref}）`,
      { table, rowIndex }
    );
  }
  if (asNumber(row.version) == null) {
    throw new ProviderTableSnapshotError(
      "INVALID_SECRET_ROW",
      `sksp_secrets 第 ${rowIndex} 行 version 不是数字（ref=${ref}）`,
      { table, rowIndex }
    );
  }
}

/**
 * 对即将写入主库的快照做整体校验：行级字段 + 跨表 FK 一致性。
 * 任一行非法即抛 {@link ProviderTableSnapshotError}，调用方应在事务外
 * 先调用本函数，再决定是否进入 scrub + INSERT 流程。
 */
export function validateProviderTableSnapshot(
  snapshot: ProviderTableSnapshot
): void {
  snapshot.llm_provider.forEach((row, index) => {
    validateProviderRow(row, index);
  });
  const knownProviderIds = new Set(
    snapshot.llm_provider
      .map((row) => nonEmptyString(row.id))
      .filter((id): id is string => id != null)
  );
  snapshot.llm_saved_model.forEach((row, index) => {
    validateSavedModelRow(row, index, knownProviderIds);
  });
  snapshot.sksp_secrets.forEach((row, index) => {
    validateSecretRow(row, index);
  });
}
