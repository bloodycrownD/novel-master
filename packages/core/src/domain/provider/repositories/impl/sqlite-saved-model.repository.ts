/**
 * SQLite `llm_saved_model` repository.
 *
 * @module domain/provider/repositories/impl/sqlite-saved-model.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { LlmSavedModelSql } from "@/infra/sql-template/generated/llm_saved_model.mapper.generated.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { SavedModelSettingsJson } from "../../model/saved-model-settings-from-json.js";
import type { SavedModel } from "../../model/saved-model.js";
import type { SavedModelRepository } from "../saved-model.port.js";

/** 行 → 实体转码：settings 解码失败经 `Result.err` 原样接力（坏行按仓储边界上报）。 */
function rowToSaved(row: Row): Result<SavedModel, AppError> {
  const settings = SavedModelSettingsJson.fromJson(JSON.parse(String(row.settings_json)) as unknown);
  if (!settings.ok) return Result.err(settings.error);
  return Result.ok({
    id: String(row.id),
    providerId: String(row.provider_id),
    vendorModelId: String(row.vendor_model_id),
    modelName: String(row.model_name),
    settings: settings.value,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  });
}

/** TDBC-backed saved model repository. */
export class SqliteSavedModelRepository implements SavedModelRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listByProvider(providerId: string): Promise<Result<SavedModel[], AppError>> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, LlmSavedModelSql.listByProvider, { providerId });
    const out: SavedModel[] = [];
    for (const row of rows) {
      const saved = rowToSaved(row);
      if (!saved.ok) return Result.err(saved.error);
      out.push(saved.value);
    }
    return Result.ok(out);
  }

  async findById(id: string): Promise<Result<SavedModel | null, AppError>> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, LlmSavedModelSql.findById, { id });
    if (rows.length === 0) return Result.ok(null);
    return rowToSaved(rows[0]!);
  }

  async insert(model: SavedModel): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, LlmSavedModelSql.insert, {
      id: model.id,
      providerId: model.providerId,
      vendorModelId: model.vendorModelId,
      modelName: model.modelName,
      settingsJson: JSON.stringify(SavedModelSettingsJson.toJson(model.settings)),
      createdAtMs: model.createdAtMs,
      updatedAtMs: model.updatedAtMs,
    });
  }

  async updateById(model: SavedModel): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, LlmSavedModelSql.updateById, {
      id: model.id,
      modelName: model.modelName,
      settingsJson: JSON.stringify(SavedModelSettingsJson.toJson(model.settings)),
      updatedAtMs: model.updatedAtMs,
    });
  }

  /** nm-style: keep-public — 实现 SavedModelRepository 端口，由 service 经接口注入调用。 */
  async deleteById(id: string): Promise<boolean> {
    const result = await TdbcTemplate.execute(this.conn, this.parser, LlmSavedModelSql.deleteById, { id });
    return result.changes > 0;
  }

  async deleteByProvider(providerId: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, LlmSavedModelSql.deleteByProvider, { providerId });
  }
}
