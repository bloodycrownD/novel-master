/**
 * 将已保存模型的思考设置解析为协议级 {@link ModelThinkingParams}。
 *
 * @module domain/provider/logic/resolve-thinking-wire
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import {
  GEMINI_SAMPLING_DEFAULTS,
  OPENAI_SAMPLING_DEFAULTS,
} from "@/domain/provider/model/protocol-sampling-defaults.js";
import type { SavedModelSamplingSettings } from "@/domain/provider/model/saved-model-settings.js";
import type { SavedModelThinkingSettings } from "@/domain/provider/model/saved-model-settings.js";
import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";

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

/** 判断 Gemini 型号是否应使用 thinkingLevel 而非 thinkingBudget。 */
function geminiUsesThinkingLevel(vendorModelId: string): boolean {
  const id = vendorModelId.toLowerCase();
  return id.includes("gemini-3") || id.startsWith("gemini-3.");
}

/**
 * 思考开关开启且无自定义 params 时，按协议注入产品默认 wire 参数。
 *
 * @param protocol Provider 协议。
 * @param vendorModelId 厂商模型 id（Gemini 启发式用）。
 * @param sampling 已保存采样小节（用于 Anthropic budget 上限）。
 */
export function resolveThinkingWireDefaults(
  protocol: LlmProtocolKind,
  vendorModelId: string,
  sampling: SavedModelSamplingSettings,
): ModelThinkingParams {
  switch (protocol) {
    case "anthropic": {
      const effectiveMax = resolveEffectiveMaxTokens(sampling, "anthropic");
      const budget = Math.min(10_000, Math.max(1, effectiveMax - 1));
      return {
        protocol: "anthropic",
        anthropic: { type: "enabled", budget_tokens: budget },
      };
    }
    case "openai":
      return {
        protocol: "openai",
        openai: { reasoning_effort: "medium" },
      };
    case "gemini":
      if (geminiUsesThinkingLevel(vendorModelId)) {
        return {
          protocol: "gemini",
          gemini: { thinkingConfig: { thinkingLevel: "medium" } },
        };
      }
      return {
        protocol: "gemini",
        gemini: { thinkingConfig: { thinkingBudget: -1 } },
      };
  }
}

/**
 * 将已保存思考设置解析为与 provider 协议匹配的请求参数。
 *
 * @param protocol Provider 协议。
 * @param thinking 已保存思考小节。
 * @param sampling 已保存采样小节。
 * @param vendorModelId 厂商模型 id。
 */
export function resolveThinkingParamsForProtocol(
  protocol: LlmProtocolKind,
  thinking: SavedModelThinkingSettings,
  sampling: SavedModelSamplingSettings,
  vendorModelId: string,
): ModelThinkingParams | undefined {
  if (!thinking.enabled) {
    return undefined;
  }
  if (thinking.params != null && thinking.params.protocol === protocol) {
    return thinking.params;
  }
  return resolveThinkingWireDefaults(protocol, vendorModelId, sampling);
}
