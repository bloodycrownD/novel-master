/**
 * SQLite `llm_saved_model` repository.
 *
 * @module domain/provider/repositories/impl/sqlite-saved-model.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { savedModelSettingsFromJson } from "../../model/saved-model-settings-from-json.js";
import { savedModelSettingsToJson } from "../../model/saved-model-settings-from-json.js";
import type { SavedModel } from "../../model/saved-model.js";
import type { SavedModelRepository } from "../saved-model.port.js";

function rowToSaved(row: Row): SavedModel {
  const settingsJson = String(row.settings_json);
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    vendorModelId: String(row.vendor_model_id),
    modelName: String(row.model_name),
    settings: savedModelSettingsFromJson(JSON.parse(settingsJson) as unknown),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed saved model repository. */
export class SqliteSavedModelRepository implements SavedModelRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listByProvider(providerId: string): Promise<SavedModel[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms
       FROM llm_saved_model WHERE provider_id = #{providerId}
       ORDER BY vendor_model_id, model_name`,
      { providerId },
    );
    return rows.map(rowToSaved);
  }

  async findById(id: string): Promise<SavedModel | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms
       FROM llm_saved_model WHERE id = #{id}`,
      { id },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToSaved(rows[0]!);
  }

  async insert(model: SavedModel): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO llm_saved_model (
        id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms
      ) VALUES (
        #{id}, #{providerId}, #{vendorModelId}, #{modelName}, #{settingsJson}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        id: model.id,
        providerId: model.providerId,
        vendorModelId: model.vendorModelId,
        modelName: model.modelName,
        settingsJson: JSON.stringify(savedModelSettingsToJson(model.settings)),
        createdAtMs: model.createdAtMs,
        updatedAtMs: model.updatedAtMs,
      },
    );
  }

  async updateById(model: SavedModel): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE llm_saved_model SET
        model_name = #{modelName},
        settings_json = #{settingsJson},
        updated_at_ms = #{updatedAtMs}
       WHERE id = #{id}`,
      {
        id: model.id,
        modelName: model.modelName,
        settingsJson: JSON.stringify(savedModelSettingsToJson(model.settings)),
        updatedAtMs: model.updatedAtMs,
      },
    );
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM llm_saved_model WHERE id = #{id}`,
      { id },
    );
    return result.changes > 0;
  }

  async deleteByProvider(providerId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM llm_saved_model WHERE provider_id = #{providerId}`,
      { providerId },
    );
  }
}
