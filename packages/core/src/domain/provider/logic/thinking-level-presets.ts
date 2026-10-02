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

/**
 * thinking budget 占 `max_tokens` 的上限比例。
 *
 * Anthropic 的 `max_tokens` **含 thinking 占用** ⇒ budget 必须是它的一个真子集，
 * 留 20% 给可见正文。旧形态用 `effectiveMax - 1`：在 max=4096 时三档 preset
 * （4096/8192/16384）全被钳成 4095 ⇒ 可见正文只剩 1 token 且三档无差别。
 * 改比例后 max=16000 时三档分别是 4096 / 8192 / 12800。
 */
const ANTHROPIC_THINKING_BUDGET_RATIO = 0.8;

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
  sampling: SavedModelSamplingSettings
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
        Math.max(1, Math.floor(effectiveMax * ANTHROPIC_THINKING_BUDGET_RATIO))
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
        gemini: {
          thinkingConfig: { thinkingBudget: GEMINI_25_PRESET_BUDGET[level] },
        },
      };
  }
}
