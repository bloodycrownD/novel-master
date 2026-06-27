/**
 * 思考强度档位 → 协议级 {@link ModelThinkingParams} 的内部 preset 表。
 *
 * @module domain/provider/logic/thinking-level-presets
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";
import type { SavedModelSamplingSettings } from "@/domain/provider/model/saved-model-settings.js";
import type { ThinkingLevel } from "@/domain/provider/model/saved-model-settings.js";
import { resolveEffectiveMaxTokens } from "./resolve-thinking-wire.js";

/** Anthropic 各档位钳制前的 budget_tokens 常数。 */
const ANTHROPIC_PRESET_BUDGET: Record<Exclude<ThinkingLevel, "off">, number> = {
  low: 4096,
  medium: 8192,
  high: 16384,
};

/** Gemini 2.5 各档位 thinkingBudget 常数。 */
const GEMINI_25_PRESET_BUDGET: Record<Exclude<ThinkingLevel, "off">, number> = {
  low: 4096,
  medium: -1,
  high: 16384,
};

/** 判断 Gemini 型号是否应使用 thinkingLevel 而非 thinkingBudget。 */
function geminiUsesThinkingLevel(vendorModelId: string): boolean {
  const id = vendorModelId.toLowerCase();
  return id.includes("gemini-3") || id.startsWith("gemini-3.");
}

/**
 * 将持久化档位解析为与 provider 协议匹配的请求参数。
 *
 * @param level 已保存思考强度档位；`off` 时返回 `undefined`。
 * @param protocol Provider 协议。
 * @param vendorModelId 厂商模型 id（Gemini 启发式用）。
 * @param sampling 已保存采样小节（Anthropic budget 上限钳制用）。
 */
export function thinkingLevelToModelThinkingParams(
  level: ThinkingLevel,
  protocol: LlmProtocolKind,
  vendorModelId: string,
  sampling: SavedModelSamplingSettings,
): ModelThinkingParams | undefined {
  if (level === "off") {
    return undefined;
  }

  switch (protocol) {
    case "openai":
      return {
        protocol: "openai",
        openai: { reasoning_effort: level },
      };
    case "anthropic": {
      const effectiveMax = resolveEffectiveMaxTokens(sampling, "anthropic");
      const budget = Math.min(
        ANTHROPIC_PRESET_BUDGET[level],
        Math.max(1, effectiveMax - 1),
      );
      return {
        protocol: "anthropic",
        anthropic: { type: "enabled", budget_tokens: budget },
      };
    }
    case "gemini":
      if (geminiUsesThinkingLevel(vendorModelId)) {
        return {
          protocol: "gemini",
          gemini: { thinkingConfig: { thinkingLevel: level } },
        };
      }
      return {
        protocol: "gemini",
        gemini: { thinkingConfig: { thinkingBudget: GEMINI_25_PRESET_BUDGET[level] } },
      };
  }
}
