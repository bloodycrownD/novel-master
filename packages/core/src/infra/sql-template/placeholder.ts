/**
 * Renders `#{path}` (bound placeholder) and `${path}` (string embed) nodes.
 */

import { resolvePath } from "./context.js";
import type { ContextStack } from "./context.js";

export interface BindResult {
  fragment: string;
  parameters: unknown[];
}

/**
 * Renders a `#{path}` or `${path}` bind node.
 */
export function renderBind(
  kind: "hash" | "dollar",
  path: string,
  stack: ContextStack,
  placeholder: string,
): BindResult {
  const value = resolvePath(stack, path);
  if (kind === "hash") {
    return { fragment: placeholder, parameters: [value] };
  }
  const text = value === null || value === undefined ? "" : String(value);
  return { fragment: text, parameters: [] };
}
