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

/** Value + Chinese label for model settings select (value persisted to DB). */
export const TOKEN_COUNTER_MODE_SELECT_OPTIONS: ReadonlyArray<{
  readonly value: TokenizerOverride;
  readonly label: string;
}> = [
  { value: "auto", label: "自动（按模型名匹配）" },
  { value: "heuristic", label: "启发式估算" },
  { value: "tiktoken", label: "Tiktoken（OpenAI 等）" },
  { value: "claude", label: "Claude 分词器" },
  { value: "gemma", label: "Gemma 分词器" },
  { value: "llama3", label: "Llama 3 分词器" },
  { value: "mistral", label: "Mistral 分词器" },
];
