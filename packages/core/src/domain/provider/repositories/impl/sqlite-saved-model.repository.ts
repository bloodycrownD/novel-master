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
    providerId: String(row.provider_id),
    vendorModelId: String(row.vendor_model_id),
    displayName: row.display_name != null ? String(row.display_name) : null,
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
      `SELECT provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
       FROM llm_saved_model WHERE provider_id = #{providerId}
       ORDER BY vendor_model_id`,
      { providerId },
    );
    return rows.map(rowToSaved);
  }

  async find(
    providerId: string,
    vendorModelId: string,
  ): Promise<SavedModel | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
       FROM llm_saved_model
       WHERE provider_id = #{providerId} AND vendor_model_id = #{vendorModelId}`,
      { providerId, vendorModelId },
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
        provider_id, vendor_model_id, display_name, settings_json, created_at_ms, updated_at_ms
      ) VALUES (
        #{providerId}, #{vendorModelId}, #{displayName}, #{settingsJson}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        providerId: model.providerId,
        vendorModelId: model.vendorModelId,
        displayName: model.displayName,
        settingsJson: JSON.stringify(savedModelSettingsToJson(model.settings)),
        createdAtMs: model.createdAtMs,
        updatedAtMs: model.updatedAtMs,
      },
    );
  }

  async update(model: SavedModel): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE llm_saved_model SET
        display_name = #{displayName},
        settings_json = #{settingsJson},
        updated_at_ms = #{updatedAtMs}
       WHERE provider_id = #{providerId} AND vendor_model_id = #{vendorModelId}`,
      {
        providerId: model.providerId,
        vendorModelId: model.vendorModelId,
        displayName: model.displayName,
        settingsJson: JSON.stringify(savedModelSettingsToJson(model.settings)),
        updatedAtMs: model.updatedAtMs,
      },
    );
  }

  async delete(providerId: string, vendorModelId: string): Promise<boolean> {
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM llm_saved_model
       WHERE provider_id = #{providerId} AND vendor_model_id = #{vendorModelId}`,
      { providerId, vendorModelId },
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
