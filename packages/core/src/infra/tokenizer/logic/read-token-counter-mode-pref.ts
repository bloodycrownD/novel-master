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

export const TOKEN_COUNTER_MODE_PREF_KEY = "tokenCounter.mode";

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

/** Parses stored preference value into registry override. */
export function parseTokenCounterModePref(raw: string | undefined): TokenizerOverride {
  if (raw == null || raw === "" || raw === "auto") {
    return "auto";
  }
  if (raw === "heuristic") {
    return "heuristic";
  }
  if (VALID_FAMILIES.has(raw)) {
    return raw as TokenizerFamily;
  }
  return "auto";
}
