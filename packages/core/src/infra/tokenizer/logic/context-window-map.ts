/**
 * Static vendor model id substring → context window (tokens).
 *
 * @module infra/tokenizer/logic/context-window-map
 */

/** Ordered substring rules (first match wins). */
export const CONTEXT_WINDOW_RULES: readonly {
  readonly substrings: readonly string[];
  readonly tokens: number;
}[] = [
  { substrings: ["claude-3-5", "claude-3-7"], tokens: 200_000 },
  { substrings: ["claude-3"], tokens: 200_000 },
  { substrings: ["gpt-4o"], tokens: 128_000 },
  { substrings: ["gpt-4-turbo"], tokens: 128_000 },
  { substrings: ["gpt-3.5"], tokens: 16_385 },
  { substrings: ["gemini-2.0", "gemini-1.5"], tokens: 1_048_576 },
  { substrings: ["gemini"], tokens: 1_000_000 },
];

/** Default when no rule matches and a numeric fallback is required. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
