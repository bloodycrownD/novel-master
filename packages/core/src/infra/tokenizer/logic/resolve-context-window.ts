/**
 * Resolves model context window from vendor model id substring table.
 *
 * @module infra/tokenizer/logic/resolve-context-window
 */

import { CONTEXT_WINDOW_RULES } from "./context-window-map.js";

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
