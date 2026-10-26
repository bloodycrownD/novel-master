/**
 * SQLite `llm_saved_model` repository.
 *
 * @module domain/provider/repositories/impl/sqlite-saved-model.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { executeTemplate, queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { savedModelSettingsFromJson, savedModelSettingsToJson } from "../../model/saved-model-settings-from-json.js";
import type { SavedModel } from "../../model/saved-model.js";
import type { SavedModelRepository } from "../saved-model.port.js";

const SAVED_MODEL_COLUMNS = "id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms";
const SELECT_BY_PROVIDER_SQL = `SELECT ${SAVED_MODEL_COLUMNS} FROM llm_saved_model WHERE provider_id = #{providerId} ORDER BY vendor_model_id, model_name`;
const SELECT_BY_ID_SQL = `SELECT ${SAVED_MODEL_COLUMNS} FROM llm_saved_model WHERE id = #{id}`;
const INSERT_SQL = `INSERT INTO llm_saved_model (${SAVED_MODEL_COLUMNS}) VALUES (#{id}, #{providerId}, #{vendorModelId}, #{modelName}, #{settingsJson}, #{createdAtMs}, #{updatedAtMs})`;
const UPDATE_SQL = `UPDATE llm_saved_model SET model_name = #{modelName}, settings_json = #{settingsJson}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}`;
const DELETE_BY_ID_SQL = "DELETE FROM llm_saved_model WHERE id = #{id}";
const DELETE_BY_PROVIDER_SQL = "DELETE FROM llm_saved_model WHERE provider_id = #{providerId}";

function rowToSaved(row: Row): SavedModel {
  const settings = savedModelSettingsFromJson(JSON.parse(String(row.settings_json)) as unknown);
  if (!settings.ok) throw settings.error;
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    vendorModelId: String(row.vendor_model_id),
    modelName: String(row.model_name),
    settings: settings.value,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed saved model repository. */
export class SqliteSavedModelRepository implements SavedModelRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listByProvider(providerId: string): Promise<SavedModel[]> {
    const rows = await queryTemplate(this.conn, this.parser, SELECT_BY_PROVIDER_SQL, { providerId });
    return rows.map(rowToSaved);
  }

  async findById(id: string): Promise<SavedModel | null> {
    const rows = await queryTemplate(this.conn, this.parser, SELECT_BY_ID_SQL, { id });
    if (rows.length === 0) return null;
    return rowToSaved(rows[0]!);
  }

  async insert(model: SavedModel): Promise<void> {
    await executeTemplate(this.conn, this.parser, INSERT_SQL, {
      id: model.id,
      providerId: model.providerId,
      vendorModelId: model.vendorModelId,
      modelName: model.modelName,
      settingsJson: JSON.stringify(savedModelSettingsToJson(model.settings)),
      createdAtMs: model.createdAtMs,
      updatedAtMs: model.updatedAtMs,
    });
  }

  async updateById(model: SavedModel): Promise<void> {
    await executeTemplate(this.conn, this.parser, UPDATE_SQL, {
      id: model.id,
      modelName: model.modelName,
      settingsJson: JSON.stringify(savedModelSettingsToJson(model.settings)),
      updatedAtMs: model.updatedAtMs,
    });
  }

  /** nm-style: keep-public — 实现 SavedModelRepository 端口，由 service 经接口注入调用。 */
  async deleteById(id: string): Promise<boolean> {
    const result = await executeTemplate(this.conn, this.parser, DELETE_BY_ID_SQL, { id });
    return result.changes > 0;
  }

  async deleteByProvider(providerId: string): Promise<void> {
    await executeTemplate(this.conn, this.parser, DELETE_BY_PROVIDER_SQL, { providerId });
  }
}
