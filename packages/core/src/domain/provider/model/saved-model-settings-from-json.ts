/**
 * 与格式无关的已保存模型 settings 解析。
 *
 * @module domain/provider/model/saved-model-settings-from-json
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { SavedModelSettings } from "./saved-model-settings.js";
import {
  savedModelSettingsSchema,
  type SavedModelSettingsDocument,
} from "./saved-model-settings.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * 将 plain JSON 解析并校验为 {@link SavedModelSettings}（内存恒为 v2）。
 */
export function savedModelSettingsFromJson(raw: unknown): SavedModelSettings {
  const parsed = savedModelSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError("INVALID_ARGUMENT", zodMessage(parsed.error));
  }
  return parsed.data;
}

/**
 * 将 {@link SavedModelSettings} 序列化为 v2 JSON 文档。
 */
export function savedModelSettingsToJson(
  settings: SavedModelSettings,
): SavedModelSettingsDocument {
  return {
    schemaVersion: 2,
    internal: {
      contextWindowTokens: settings.internal.contextWindowTokens,
      tokenCounterMode: settings.internal.tokenCounterMode,
    },
    generation: {
      sampling: settings.generation.sampling,
      thinking: settings.generation.thinking,
    },
  };
}

/**
 * merge 后 round-trip 校验，确保 patch 结果可持久化。
 *
 * @param settings 合并后的设置。
 */
export function assertSavedModelSettingsPersistable(settings: SavedModelSettings): void {
  savedModelSettingsFromJson(savedModelSettingsToJson(settings));
}
