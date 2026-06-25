/**
 * 将 {@link ModelThinkingParams} 合并进各协议 HTTP 请求 body。
 *
 * @module infra/llm-protocol/logic/apply-thinking-to-body
 */

import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";

/**
 * 若 thinking 为 Anthropic 协议，写入 `body.thinking`。
 *
 * @param body 待序列化的请求 body。
 * @param thinking 协议级思考参数；缺失或协议不匹配时不写入。
 */
export function applyAnthropicThinkingToBody(
  body: Record<string, unknown>,
  thinking: ModelThinkingParams | undefined,
): void {
  if (thinking?.protocol !== "anthropic") {
    return;
  }
  body.thinking = {
    type: thinking.anthropic.type,
    budget_tokens: thinking.anthropic.budget_tokens,
  };
}

/**
 * 若 thinking 为 OpenAI 协议，写入 `reasoning_effort`。
 *
 * @param body 待序列化的请求 body。
 * @param thinking 协议级思考参数；缺失或协议不匹配时不写入。
 */
export function applyOpenAiThinkingToBody(
  body: Record<string, unknown>,
  thinking: ModelThinkingParams | undefined,
): void {
  if (thinking?.protocol !== "openai") {
    return;
  }
  body.reasoning_effort = thinking.openai.reasoning_effort;
}

/**
 * 若 thinking 为 Gemini 协议，合并 `generationConfig.thinkingConfig`。
 *
 * @param body 待序列化的请求 body。
 * @param thinking 协议级思考参数；缺失或协议不匹配时不写入。
 */
export function applyGeminiThinkingToBody(
  body: Record<string, unknown>,
  thinking: ModelThinkingParams | undefined,
): void {
  if (thinking?.protocol !== "gemini") {
    return;
  }
  const existing = (body.generationConfig ?? {}) as Record<string, unknown>;
  body.generationConfig = {
    ...existing,
    thinkingConfig: { ...thinking.gemini.thinkingConfig },
  };
}
