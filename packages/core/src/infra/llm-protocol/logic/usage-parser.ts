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

/** cache 计数：非负有限数即保留——显式 0 是供应商上报的「未命中」，落库 0 计入分母；仅字段缺失（undefined / 非有限数 / 负数）视为缺席。 */
function nonNegativeNum(value: unknown): number | undefined {
  const n = num(value);
  return n != null && n >= 0 ? n : undefined;
}

/** 仅在值存在时展开字段，保持「无 cache 字段 → 返回对象不含该二字段」的契约。 */
function cacheFields(
  cacheReadTokens?: number,
  cacheCreationTokens?: number,
): Pick<LlmTokenUsage, "cacheReadTokens" | "cacheCreationTokens"> {
  return {
    ...(cacheReadTokens != null ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens != null ? { cacheCreationTokens } : {}),
  };
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
  // OpenAI 无 cache write 概念，只读命中侧 cached_tokens。
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
  const cacheReadTokens = nonNegativeNum(details?.cached_tokens);
  return { promptTokens, completionTokens, totalTokens, ...cacheFields(cacheReadTokens) };
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
  const cacheReadTokens = nonNegativeNum(usage.cache_read_input_tokens);
  // cache_creation 有两种 wire 形态：新版嵌套 cache_creation.input_tokens，旧版扁平 cache_creation_input_tokens。
  const cacheCreation = isRecord(usage.cache_creation)
    ? nonNegativeNum(usage.cache_creation.input_tokens)
    : nonNegativeNum(usage.cache_creation_input_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...cacheFields(cacheReadTokens, cacheCreation),
  };
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
  const cacheReadTokens = nonNegativeNum(meta.cachedContentTokenCount);
  return { promptTokens, completionTokens, totalTokens, ...cacheFields(cacheReadTokens) };
}
