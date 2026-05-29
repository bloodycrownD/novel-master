/**
 * Provider-specific model sampling parameters.
 *
 * @module domain/agent/model/model-sampling-params
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/adapter.port.js";

/** OpenAI-compatible sampling fields. */
export interface OpenAiSamplingParams {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly max_tokens?: number;
}

/** Anthropic Messages API sampling fields. */
export interface AnthropicSamplingParams {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly max_tokens?: number;
}

/** Gemini generateContent sampling fields. */
export interface GeminiSamplingParams {
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly maxOutputTokens?: number;
}

/** Discriminated union keyed by provider protocol. */
export type ModelSamplingParams =
  | { readonly protocol: "openai"; readonly openai: OpenAiSamplingParams }
  | { readonly protocol: "anthropic"; readonly anthropic: AnthropicSamplingParams }
  | { readonly protocol: "gemini"; readonly gemini: GeminiSamplingParams };

/** Returns the protocol tag for sampling params, if any. */
export function samplingProtocol(
  params: ModelSamplingParams | undefined,
): LlmProtocolKind | undefined {
  return params?.protocol;
}
