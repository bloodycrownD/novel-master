/**
 * Breaking migrations for model-context-settings iteration.
 *
 * WHY: legacy KKV/SQLite paths must be purged before new settings_json backfill.
 *
 * @module bootstrap/provider/migrate-model-context-settings
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { defaultSavedModelSettings } from "@/domain/provider/model/default-saved-model-settings.js";
import { savedModelSettingsToJson } from "@/domain/provider/model/saved-model-settings-from-json.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";

/** Deletes all keys under legacy `nm-model-sampling` module. */
export async function migratePurgeNmModelSamplingKkv(
  kkv: KkvService,
): Promise<void> {
  const keys = await kkv.listKeys("nm-model-sampling");
  for (const key of keys) {
    await kkv.delete("nm-model-sampling", key);
  }
}

/** Drops legacy SQLite suggestion table (not migrated to KKV). */
export async function migrateDropLlmModelSuggestionTable(
  tx: TdbcConnection,
): Promise<void> {
  await tx.execute("DROP TABLE IF EXISTS llm_model_suggestion");
}

/** Adds `settings_json` column and backfills defaults per vendor model id. */
export async function migrateAddSavedModelSettingsJson(
  tx: TdbcConnection,
): Promise<void> {
  const rows = await tx.query(
    "SELECT name FROM pragma_table_info('llm_saved_model')",
  );
  const names = rows.map((r) => String(r.name));
  if (!names.includes("settings_json")) {
    await tx.execute(
      "ALTER TABLE llm_saved_model ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
    );
  }

  const savedRows = await tx.query(
    "SELECT provider_id, vendor_model_id, settings_json FROM llm_saved_model",
  );
  for (const row of savedRows) {
    const vendorModelId = String(row.vendor_model_id);
    const providerId = String(row.provider_id);
    const existingJson = String(row.settings_json ?? "{}");
    if (existingJson !== "{}" && existingJson.trim() !== "") {
      continue;
    }
    const settings = defaultSavedModelSettings(vendorModelId);
    const json = JSON.stringify(savedModelSettingsToJson(settings));
    await tx.execute(
      "UPDATE llm_saved_model SET settings_json = ? WHERE provider_id = ? AND vendor_model_id = ?",
      [json, providerId, vendorModelId],
    );
  }
}
