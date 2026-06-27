/**
 * 思考强度档位解析为协议级 {@link ModelThinkingParams} 的入口。
 *
 * @module domain/provider/logic/resolve-thinking-wire
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import {
  GEMINI_SAMPLING_DEFAULTS,
  OPENAI_SAMPLING_DEFAULTS,
} from "@/domain/provider/model/protocol-sampling-defaults.js";
import type { SavedModelSamplingSettings } from "@/domain/provider/model/saved-model-settings.js";
import type { ThinkingLevel } from "@/domain/provider/model/saved-model-settings.js";
import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";
import { thinkingLevelToModelThinkingParams } from "./thinking-level-presets.js";

/** Anthropic adapter 未指定 sampling max_tokens 时的 body 默认值。 */
const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = 4096;

/**
 * 根据采样设置推断有效 max_tokens（用于 Anthropic budget 上限计算）。
 *
 * @param sampling 已保存采样小节。
 * @param protocol 目标协议。
 */
export function resolveEffectiveMaxTokens(
  sampling: SavedModelSamplingSettings,
  protocol: LlmProtocolKind,
): number {
  if (sampling.enabled && sampling.params != null) {
    switch (protocol) {
      case "openai":
        if (sampling.params.protocol === "openai" && sampling.params.openai.max_tokens != null) {
          return sampling.params.openai.max_tokens;
        }
        return OPENAI_SAMPLING_DEFAULTS.max_tokens;
      case "anthropic":
        if (
          sampling.params.protocol === "anthropic" &&
          sampling.params.anthropic.max_tokens != null
        ) {
          return sampling.params.anthropic.max_tokens;
        }
        return ANTHROPIC_BODY_DEFAULT_MAX_TOKENS;
      case "gemini":
        if (
          sampling.params.protocol === "gemini" &&
          sampling.params.gemini.maxOutputTokens != null
        ) {
          return sampling.params.gemini.maxOutputTokens;
        }
        return GEMINI_SAMPLING_DEFAULTS.maxOutputTokens;
    }
  }
  switch (protocol) {
    case "openai":
      return OPENAI_SAMPLING_DEFAULTS.max_tokens;
    case "anthropic":
      return ANTHROPIC_BODY_DEFAULT_MAX_TOKENS;
    case "gemini":
      return GEMINI_SAMPLING_DEFAULTS.maxOutputTokens;
  }
}

/**
 * 将已保存思考强度档位解析为与 provider 协议匹配的请求参数。
 *
 * @param level 思考强度档位。
 * @param protocol Provider 协议。
 * @param sampling 已保存采样小节。
 * @param vendorModelId 厂商模型 id。
 */
export function resolveThinkingParamsForLevel(
  level: ThinkingLevel,
  protocol: LlmProtocolKind,
  sampling: SavedModelSamplingSettings,
  vendorModelId: string,
): ModelThinkingParams | undefined {
  return thinkingLevelToModelThinkingParams(level, protocol, vendorModelId, sampling);
}
