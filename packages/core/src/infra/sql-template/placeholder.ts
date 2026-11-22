/**
 * Renders `#{path}` (bound placeholder) and `${path}` (string embed) nodes.
 */

import { SqlTemplateContext } from "./context.js";
import type { ContextStack } from "./context.js";

interface BindResult {
    fragment: string;
    parameters: unknown[];
}

/**
 * `#{path}` / `${path}` 占位符渲染。
 */
export const SqlTemplatePlaceholder = {
    /**
   * Renders a `#{path}` or `${path}` bind node.
   */
    renderBind(kind: "hash" | "dollar", path: string, stack: ContextStack, placeholder: string): BindResult {
        const value = SqlTemplateContext.resolvePath(stack, path);
        if (kind === "hash") {
            return { fragment: placeholder, parameters: [value] };
        }
        const text = value === null || value === undefined ? "" : String(value);
        return { fragment: text, parameters: [] };
    },
} as const;
