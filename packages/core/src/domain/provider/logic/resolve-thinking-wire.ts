/**
 * 请求侧 wire 默认值：Anthropic 未指定 `max_tokens` 时的 body 默认，以及
 * 「有效 max_tokens」推断（思考 budget 上限钳制用）。
 *
 * 档位 → {@link ModelThinkingParams} 的唯一实现是 `thinking-level-presets.ts`
 * 的 `thinkingLevelToModelThinkingParams`，签名固定为
 * `(level, protocol, vendorModelId, sampling)`。
 *
 * @module domain/provider/logic/resolve-thinking-wire
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { ANTHROPIC_SAMPLING_DEFAULTS, GEMINI_SAMPLING_DEFAULTS, OPENAI_SAMPLING_DEFAULTS } from "@/domain/provider/model/protocol-sampling-defaults.js";
import type { SavedModelSamplingSettings } from "@/domain/provider/model/saved-model-settings.js";

/**
 * Anthropic adapter 未指定 sampling max_tokens 时的 body 默认值。
 *
 * ⚠️ 必须与 `ANTHROPIC_SAMPLING_DEFAULTS.max_tokens`（UI 采样默认值）**同源**：
 * 旧形态这里硬写 4096、那边写 16000，两个常量各写一份又互相不知道，
 * 再叠加 budget 钳制公式用 `max - 1`，三档 thinkingLevel 全部被钳成同一个值、
 * 可见正文只剩 1 token。
 */
export const ANTHROPIC_BODY_DEFAULT_MAX_TOKENS = ANTHROPIC_SAMPLING_DEFAULTS.max_tokens;

/**
 * 根据采样设置推断有效 max_tokens（用于 Anthropic budget 上限计算）。
 *
 * @param sampling 已保存采样小节。
 * @param protocol 目标协议。
 */
export function resolveEffectiveMaxTokens(sampling: SavedModelSamplingSettings, protocol: LlmProtocolKind): number {
  if (sampling.enabled && sampling.params != null) {
    switch (protocol) {
      case "openai":
        if (sampling.params.protocol === "openai" && sampling.params.openai.max_tokens != null) {
          return sampling.params.openai.max_tokens;
        }
        return OPENAI_SAMPLING_DEFAULTS.max_tokens;
      case "anthropic":
        if (sampling.params.protocol === "anthropic" && sampling.params.anthropic.max_tokens != null) {
          return sampling.params.anthropic.max_tokens;
        }
        return ANTHROPIC_BODY_DEFAULT_MAX_TOKENS;
      case "gemini":
        if (sampling.params.protocol === "gemini" && sampling.params.gemini.maxOutputTokens != null) {
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
