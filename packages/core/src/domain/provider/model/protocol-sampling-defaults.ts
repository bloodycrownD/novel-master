/**
 * Recommended protocol sampling defaults for UI display and token budget hints.
 *
 * When no saved profile is applied, adapters omit fields and the API uses its own
 * defaults; these values align with common API behavior and adapter fallbacks.
 *
 * @module domain/provider/model/protocol-sampling-defaults
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { ModelSamplingParams } from "./model-sampling-params.js";

/** OpenAI-compatible display / budget defaults. */
export const OPENAI_SAMPLING_DEFAULTS = {
  temperature: 1,
  top_p: 1,
  max_tokens: 128_000,
} as const;

/** Anthropic Messages API display defaults. */
export const ANTHROPIC_SAMPLING_DEFAULTS = {
  temperature: 1,
  top_p: 1,
  top_k: 256,
  max_tokens: 128_000,
} as const;

/** Gemini generateContent display defaults. */
export const GEMINI_SAMPLING_DEFAULTS = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 128_000,
} as const;

/** Merges saved params over protocol defaults (for forms and max-token display). */
export function mergeSamplingWithDefaults(
  protocol: LlmProtocolKind,
  params: ModelSamplingParams | undefined,
): ModelSamplingParams {
  switch (protocol) {
    case "openai":
      return {
        protocol: "openai",
        openai: {
          ...OPENAI_SAMPLING_DEFAULTS,
          ...(params?.protocol === "openai" ? params.openai : {}),
        },
      };
    case "anthropic":
      return {
        protocol: "anthropic",
        anthropic: {
          ...ANTHROPIC_SAMPLING_DEFAULTS,
          ...(params?.protocol === "anthropic" ? params.anthropic : {}),
        },
      };
    case "gemini":
      return {
        protocol: "gemini",
        gemini: {
          ...GEMINI_SAMPLING_DEFAULTS,
          ...(params?.protocol === "gemini" ? params.gemini : {}),
        },
      };
  }
}

/** Output token cap from effective sampling params (for prompt usage %). */
export function maxOutputTokensFromSampling(
  params: ModelSamplingParams,
): number | undefined {
  switch (params.protocol) {
    case "openai":
      return params.openai.max_tokens;
    case "anthropic":
      return params.anthropic.max_tokens;
    case "gemini":
      return params.gemini.maxOutputTokens;
  }
}
