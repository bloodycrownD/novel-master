/**
 * 已保存模型 settings_json 的领域类型（schema v2）。
 *
 * @module domain/provider/model/saved-model-settings
 */

import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import type { ModelSamplingParams } from "./model-sampling-params.js";
import type { ModelThinkingParams } from "./model-thinking-params.js";

/** {@link SavedModelGenerationSettings} 中的采样小节。 */
export interface SavedModelSamplingSettings {
  readonly enabled: boolean;
  readonly params?: ModelSamplingParams;
}

/** {@link SavedModelGenerationSettings} 中的思考小节。 */
export interface SavedModelThinkingSettings {
  readonly enabled: boolean;
  readonly params?: ModelThinkingParams;
}

/** 内部预算：不直接映射 HTTP 生成 body。 */
export interface SavedModelInternalSettings {
  readonly contextWindowTokens: number;
  readonly tokenCounterMode: TokenizerOverride;
}

/** 生成参数：采样与思考。 */
export interface SavedModelGenerationSettings {
  readonly sampling: SavedModelSamplingSettings;
  readonly thinking: SavedModelThinkingSettings;
}

/** 单条已保存模型的完整设置（内存恒为 v2）。 */
export interface SavedModelSettings {
  readonly schemaVersion: 2;
  readonly internal: SavedModelInternalSettings;
  readonly generation: SavedModelGenerationSettings;
}

/** {@link SavedModelSettings} 的部分更新（IPC 保持扁平字段）。 */
export interface SavedModelSettingsPatch {
  readonly contextWindowTokens?: number;
  readonly sampling?: SavedModelSamplingSettings;
  readonly tokenCounterMode?: TokenizerOverride;
  readonly thinking?: SavedModelThinkingSettings;
}

/** 读取上下文窗口 token 上限。 */
export function savedModelContextWindowTokens(settings: SavedModelSettings): number {
  return settings.internal.contextWindowTokens;
}

/** 读取 token 计数器模式。 */
export function savedModelTokenCounterMode(settings: SavedModelSettings): TokenizerOverride {
  return settings.internal.tokenCounterMode;
}

/** 读取生成采样小节。 */
export function savedModelSampling(settings: SavedModelSettings): SavedModelSamplingSettings {
  return settings.generation.sampling;
}

/** 读取生成思考小节。 */
export function savedModelThinking(settings: SavedModelSettings): SavedModelThinkingSettings {
  return settings.generation.thinking;
}

/**
 * 将扁平 patch 合并进已有 v2 设置。
 *
 * @param settings 当前设置。
 * @param patch 部分更新。
 */
export function applySavedModelSettingsPatch(
  settings: SavedModelSettings,
  patch: SavedModelSettingsPatch,
): SavedModelSettings {
  return {
    schemaVersion: 2,
    internal: {
      contextWindowTokens:
        patch.contextWindowTokens ?? settings.internal.contextWindowTokens,
      tokenCounterMode: patch.tokenCounterMode ?? settings.internal.tokenCounterMode,
    },
    generation: {
      sampling: patch.sampling ?? settings.generation.sampling,
      thinking: patch.thinking ?? settings.generation.thinking,
    },
  };
}
