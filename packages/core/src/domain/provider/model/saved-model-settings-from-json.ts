/**
 * Format-agnostic saved model settings parsing.
 *
 * @module domain/provider/model/saved-model-settings-from-json
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { SavedModelSettings } from "./saved-model-settings.js";
import {
  savedModelSettingsDocumentSchema,
  type SavedModelSettingsDocument,
} from "./saved-model-settings.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * Parses and validates a plain JSON object into {@link SavedModelSettings}.
 */
export function savedModelSettingsFromJson(raw: unknown): SavedModelSettings {
  const parsed = savedModelSettingsDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError("INVALID_ARGUMENT", zodMessage(parsed.error));
  }
  return documentToSettings(parsed.data);
}

/**
 * Serializes {@link SavedModelSettings} to a JSON-serializable document.
 */
export function savedModelSettingsToJson(
  settings: SavedModelSettings,
): SavedModelSettingsDocument {
  return {
    schemaVersion: 1,
    contextWindowTokens: settings.contextWindowTokens,
    sampling: settings.sampling,
  };
}

function documentToSettings(doc: SavedModelSettingsDocument): SavedModelSettings {
  return {
    schemaVersion: 1,
    contextWindowTokens: doc.contextWindowTokens,
    sampling: doc.sampling,
  };
}
