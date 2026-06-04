/**
 * Maps vendor model id substrings to tokenizer family (ST `getTokenizerModel` order).
 *
 * Unknown models intentionally return `heuristic` (not ST's default gpt-3.5-turbo).
 *
 * @module infra/tokenizer/logic/resolve-tokenizer-family
 */

import type { TokenizerFamily } from "../ports/token-counter.port.js";

/** GPT instruct/completion models that map to tiktoken by exact id. */
const TEXT_COMPLETION_MODELS = [
  "gpt-3.5-turbo-instruct",
  "gpt-3.5-turbo-instruct-0914",
  "text-davinci-003",
  "text-davinci-002",
  "text-davinci-001",
  "text-curie-001",
  "text-babbage-001",
  "text-ada-001",
  "code-davinci-002",
  "code-davinci-001",
  "code-cushman-002",
  "code-cushman-001",
  "text-davinci-edit-001",
  "code-davinci-edit-001",
  "text-embedding-ada-002",
] as const;

export type TokenizerOverride = TokenizerFamily | "auto" | "heuristic";

/**
 * Resolves tokenizer family from vendor model id and optional user override.
 *
 * @param vendorModelId Provider model name (case-insensitive substring match).
 * @param override When not `auto`, skips substring table.
 */
export function resolveTokenizerFamily(
  vendorModelId: string,
  override: TokenizerOverride = "auto",
): TokenizerFamily {
  if (override === "heuristic") {
    return "heuristic";
  }
  if (override !== "auto") {
    return override;
  }

  const id = vendorModelId.toLowerCase();

  if (
    id === "o1" ||
    id.includes("o1-preview") ||
    id.includes("o1-mini") ||
    id.includes("o3-mini")
  ) {
    return "tiktoken";
  }
  if (id.includes("o3") || id.includes("o4-mini")) {
    return "tiktoken";
  }
  if (id.includes("gpt-4o") || id.includes("chatgpt-4o")) {
    return "tiktoken";
  }
  if (id.includes("gpt-4.1") || id.includes("gpt-4.5")) {
    return "tiktoken";
  }
  if (id.includes("gpt-4-32k")) {
    return "tiktoken";
  }
  if (id.includes("gpt-4")) {
    return "tiktoken";
  }
  if (id.includes("gpt-3.5-turbo-0301")) {
    return "tiktoken";
  }
  if (id.includes("gpt-3.5-turbo")) {
    return "tiktoken";
  }
  if ((TEXT_COMPLETION_MODELS as readonly string[]).includes(id)) {
    return "tiktoken";
  }
  if (id.includes("claude")) {
    return "claude";
  }
  if (id.includes("llama3") || id.includes("llama-3")) {
    return "llama3";
  }
  if (id.includes("llama")) {
    return "llama";
  }
  if (id.includes("mistral") || id.includes("mixtral")) {
    return "mistral";
  }
  if (id.includes("yi")) {
    return "yi";
  }
  if (id.includes("deepseek")) {
    return "deepseek";
  }
  if (id.includes("gemma") || id.includes("gemini") || id.includes("learnlm")) {
    return "gemma";
  }
  if (id.includes("jamba")) {
    return "jamba";
  }
  if (id.includes("qwen2") || id.includes("qwen")) {
    return "qwen2";
  }
  if (id.includes("command-a")) {
    return "command-a";
  }
  if (id.includes("command-r")) {
    return "command-r";
  }
  if (id.includes("nemo") || id.includes("pixtral")) {
    return "nemo";
  }
  if (id.includes("gpt2")) {
    return "gpt2";
  }

  return "heuristic";
}

/** @deprecated Use {@link resolveTokenizerFamily}. Kept for tiktoken encoding map callers. */
export function mapVendorModelIdToTiktokenModel(vendorModelId: string): string {
  const id = vendorModelId.toLowerCase();

  if (id.includes("gpt-3.5-turbo-0301")) {
    return "gpt-3.5-turbo-0301";
  }
  if (id.includes("gpt-4o") || id.includes("chatgpt-4o")) {
    return "gpt-4o";
  }
  if (id.includes("gpt-4.1") || id.includes("gpt-4.5")) {
    return "gpt-4o";
  }
  if (id.includes("gpt-4-32k")) {
    return "gpt-4-32k";
  }
  if (
    id.includes("o1-preview") ||
    id.includes("o1-mini") ||
    id.includes("o3-mini") ||
    id.includes("o4-mini")
  ) {
    return "o1";
  }
  if (hasStandaloneToken(id, "o1") || hasStandaloneToken(id, "o3")) {
    return "o1";
  }
  if (id.includes("gpt-4")) {
    return "gpt-4";
  }
  if (id.includes("gpt-3.5-turbo")) {
    return "gpt-3.5-turbo";
  }

  return "gpt-3.5-turbo";
}

/** True when model id uses the 0301 per-message overhead variant. */
export function isGpt0301TiktokenModel(tiktokenModel: string): boolean {
  return tiktokenModel === "gpt-3.5-turbo-0301";
}

function hasStandaloneToken(id: string, token: string): boolean {
  const idx = id.indexOf(token);
  if (idx < 0) {
    return false;
  }
  const before = idx === 0 ? "" : id[idx - 1]!;
  const after = id[idx + token.length] ?? "";
  const boundary = /[^a-z0-9-]/;
  const beforeOk = idx === 0 || boundary.test(before);
  const afterOk = after === "" || boundary.test(after);
  return beforeOk && afterOk;
}
