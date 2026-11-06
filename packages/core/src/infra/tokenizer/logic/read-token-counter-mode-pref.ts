/**
 * Saved-model `tokenCounterMode` validation helpers.
 *
 * WHY: global `nm-preferences` key `tokenCounter.mode` is deprecated; per-model
 * settings use these parsers only — no public preferences read path.
 *
 * @module infra/tokenizer/logic/read-token-counter-mode-pref
 */

import type { TokenizerOverride } from "./resolve-tokenizer-family.js";
import type { TokenizerFamily } from "../ports/token-counter.port.js";

const VALID_FAMILIES: ReadonlySet<string> = new Set([
  "auto",
  "heuristic",
  "tiktoken",
  "claude",
  "llama",
  "llama3",
  "mistral",
  "yi",
  "gemma",
  "jamba",
  "qwen2",
  "command-r",
  "command-a",
  "nemo",
  "deepseek",
  "gpt2",
]);

/** True when `raw` is a known token counter mode (schema / patch validation). */
export function isValidTokenCounterModePref(raw: string): boolean {
  return VALID_FAMILIES.has(raw);
}

/**
 * Parses stored preference value into registry override.
 *
 * nm-style: keep-local — 家族白名单与旧 heuristic 归一化是 saved-model 模式的领域口径，schema 只做转接
 */
export function parseTokenCounterModePref(
  raw: string | undefined
): TokenizerOverride {
  if (raw == null || raw === "" || raw === "auto") {
    return "auto";
  }
  // `heuristic` 已从用户可选列表移除（spec 变更点 11），这里把旧数据归一化为 `auto`。
  if (raw === "heuristic") {
    return "auto";
  }
  if (VALID_FAMILIES.has(raw)) {
    return raw as TokenizerFamily;
  }
  return "auto";
}
