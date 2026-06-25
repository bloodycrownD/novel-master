/**
 * 各协议模型思考（reasoning）参数，按已保存模型配置，非 Agent 级。
 *
 * @module domain/provider/model/model-thinking-params
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

/** Anthropic Messages API thinking 字段。 */
export interface AnthropicThinkingParams {
  readonly type: "enabled";
  readonly budget_tokens: number;
}

/** OpenAI Chat Completions reasoning_effort。 */
export interface OpenAiThinkingParams {
  readonly reasoning_effort: "low" | "medium" | "high";
}

/** Gemini thinkingConfig 片段。 */
export interface GeminiThinkingConfig {
  readonly thinkingBudget?: number;
  readonly thinkingLevel?: string;
}

/** Gemini generateContent thinking 配置。 */
export interface GeminiThinkingParams {
  readonly thinkingConfig: GeminiThinkingConfig;
}

/** 按 provider protocol 区分的思考参数联合类型。 */
export type ModelThinkingParams =
  | { readonly protocol: "anthropic"; readonly anthropic: AnthropicThinkingParams }
  | { readonly protocol: "openai"; readonly openai: OpenAiThinkingParams }
  | { readonly protocol: "gemini"; readonly gemini: GeminiThinkingParams };

/** 返回思考参数的协议标签（若有）。 */
export function thinkingProtocol(
  params: ModelThinkingParams | undefined,
): LlmProtocolKind | undefined {
  return params?.protocol;
}
