/**
 * User-selectable token counter modes (Mobile model settings + CLI flags).
 *
 * @module domain/provider/model/token-counter-mode-options
 */

import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";

/** Modes shown in model settings UI and CLI `--tokenCounterMode`. */
export const TOKEN_COUNTER_MODE_OPTIONS = ["auto", "tiktoken", "claude", "gemma", "llama3", "mistral"] as const satisfies readonly TokenizerOverride[];

/** Value + label descriptor for model settings select (value persisted to DB; host translator renders). */
export const TOKEN_COUNTER_MODE_SELECT_OPTIONS: ReadonlyArray<{
  readonly value: TokenizerOverride;
  readonly label: CoreMessageDescriptor;
}> = [
  { value: "auto", label: { key: "label.provider.token_counter.auto" } },
  { value: "tiktoken", label: { key: "label.provider.token_counter.tiktoken" } },
  { value: "claude", label: { key: "label.provider.token_counter.claude" } },
  { value: "gemma", label: { key: "label.provider.token_counter.gemma" } },
  { value: "llama3", label: { key: "label.provider.token_counter.llama3" } },
  { value: "mistral", label: { key: "label.provider.token_counter.mistral" } },
];
