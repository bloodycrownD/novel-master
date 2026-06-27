/**
 * 将 {@link ModelThinkingParams} 合并进各协议 HTTP 请求 body。
 *
 * @module infra/llm-protocol/logic/apply-thinking-to-body
 */

import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";
import {
  applyGlmThinkingDisabledToBody,
  applyGlmThinkingEnabledToBody,
  isGlmDefaultThinkingOnModel,
} from "./openai-glm-thinking.js";

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
 * 若 thinking 为 OpenAI 协议，写入 `reasoning_effort`；GLM 默认开 thinking 的型号在关闭时须显式关断。
 *
 * @param body 待序列化的请求 body。
 * @param thinking 协议级思考参数；缺失或协议不匹配时不写入（GLM 默认开 thinking 型号除外）。
 * @param vendorModelId 厂商模型 id，用于 GLM 默认 thinking 检测。
 */
export function applyOpenAiThinkingToBody(
  body: Record<string, unknown>,
  thinking: ModelThinkingParams | undefined,
  vendorModelId?: string,
): void {
  const modelId = vendorModelId ?? "";
  if (isGlmDefaultThinkingOnModel(modelId)) {
    if (thinking?.protocol === "openai") {
      applyGlmThinkingEnabledToBody(body, thinking.openai.reasoning_effort);
    } else {
      applyGlmThinkingDisabledToBody(body);
    }
    return;
  }
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
