/**
 * 与格式无关的已保存模型 settings 解析。
 *
 * @module domain/provider/model/saved-model-settings-from-json
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { SavedModelSettings } from "./saved-model-settings.js";
import { savedModelSettingsSchema, type SavedModelSettingsDocument } from "./saved-model-settings.schema.js";

type SavedModelSettingsError = AppError<"PROVIDER_INVALID_ARGUMENT">;

export const SavedModelSettingsJson = {
  /**
   * 将 plain JSON 解析并校验为 {@link SavedModelSettings}（内存恒为 v2）。
   */
  fromJson(raw: unknown): Result<SavedModelSettings, SavedModelSettingsError> {
    const parsed = savedModelSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", { detail: parsed.error.message, issues: parsed.error.issues }));
    }
    return Result.ok(parsed.data);
  },

  /**
   * 将 {@link SavedModelSettings} 序列化为 v2 JSON 文档。
   */
  toJson(settings: SavedModelSettings): SavedModelSettingsDocument {
    return {
      schemaVersion: 2,
      internal: {
        contextWindowTokens: settings.internal.contextWindowTokens,
        tokenCounterMode: settings.internal.tokenCounterMode,
      },
      generation: {
        sampling: settings.generation.sampling,
        thinkingLevel: settings.generation.thinkingLevel,
      },
    };
  },

  /**
   * merge 后 round-trip 校验，确保 patch 结果可持久化。
   *
   * @param settings 合并后的设置。
   */
  assertPersistable(settings: SavedModelSettings): Result<void, SavedModelSettingsError> {
    const parsed = SavedModelSettingsJson.fromJson(SavedModelSettingsJson.toJson(settings));
    return parsed.ok ? Result.ok<void>(undefined) : Result.err(parsed.error);
  },
} as const;
