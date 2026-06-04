/**
 * Resolves model context window from vendor model id substring table.
 *
 * @module infra/tokenizer/logic/resolve-context-window
 */

import {
  CONTEXT_WINDOW_RULES,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "./context-window-map.js";

/**
 * Returns context window tokens for a vendor model id, or `undefined` when unknown.
 *
 * @param vendorModelId Provider model name.
 */
export function resolveContextWindowTokens(
  vendorModelId: string,
): number | undefined {
  const id = vendorModelId.toLowerCase();
  for (const rule of CONTEXT_WINDOW_RULES) {
    for (const sub of rule.substrings) {
      if (id.includes(sub)) {
        return rule.tokens;
      }
    }
  }
  return undefined;
}

/**
 * Context window with fallback for compaction `tokenThreshold === -1`.
 *
 * @param vendorModelId Provider model name.
 */
export function resolveContextWindowTokensOrDefault(
  vendorModelId: string,
): number {
  return resolveContextWindowTokens(vendorModelId) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
}
