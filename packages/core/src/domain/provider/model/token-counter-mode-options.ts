/**
 * User-selectable token counter modes (Mobile model settings + CLI flags).
 *
 * @module domain/provider/model/token-counter-mode-options
 */

import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";

/** Modes shown in model settings UI and CLI `--tokenCounterMode`. */
export const TOKEN_COUNTER_MODE_OPTIONS = [
  "auto",
  "heuristic",
  "tiktoken",
  "claude",
  "gemma",
  "llama3",
  "mistral",
] as const satisfies readonly TokenizerOverride[];
