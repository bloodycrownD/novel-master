/**
 * LLM response usage field parsers (OpenAI, Anthropic, Gemini shapes).
 *
 * @module infra/llm-protocol/logic/usage-parser
 */

import type { LlmTokenUsage } from "../ports/adapter.port.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parses OpenAI chat completion `usage` object. */
export function parseOpenAiUsage(raw: unknown): LlmTokenUsage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const usage = raw.usage;
  if (!isRecord(usage)) {
    return undefined;
  }
  const promptTokens = num(usage.prompt_tokens);
  const completionTokens = num(usage.completion_tokens);
  const totalTokens = num(usage.total_tokens);
  if (
    promptTokens == null &&
    completionTokens == null &&
    totalTokens == null
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/** Parses Anthropic messages API `usage` object (non-stream or stream events). */
export function parseAnthropicUsage(raw: unknown): LlmTokenUsage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  let usage = raw.usage;
  if (!isRecord(usage) && isRecord(raw.message) && isRecord(raw.message.usage)) {
    usage = raw.message.usage;
  }
  if (!isRecord(usage)) {
    return undefined;
  }
  const promptTokens = num(usage.input_tokens);
  const completionTokens = num(usage.output_tokens);
  if (promptTokens == null && completionTokens == null) {
    return undefined;
  }
  const totalTokens =
    promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : undefined;
  return { promptTokens, completionTokens, totalTokens };
}

/** Parses Gemini generateContent `usageMetadata` object. */
export function parseGeminiUsage(raw: unknown): LlmTokenUsage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const meta = raw.usageMetadata;
  if (!isRecord(meta)) {
    return undefined;
  }
  const promptTokens = num(meta.promptTokenCount);
  const completionTokens = num(meta.candidatesTokenCount);
  const totalTokens = num(meta.totalTokenCount);
  if (
    promptTokens == null &&
    completionTokens == null &&
    totalTokens == null
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}
