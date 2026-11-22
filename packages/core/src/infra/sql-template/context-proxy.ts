/**
 * Proxy wrapper so undefined property chains in test expressions yield undefined, not throw.
 */

import type { ContextStack } from "./context.js";

/**
 * 表达式求值的合并上下文构造。
 */
export const SqlTemplateContextProxy = {
    /** Builds a merged root object for expression evaluation (missing keys → undefined). */
    mergedForExpression(stack: ContextStack): Record<string, unknown> {
        const merged: Record<string, unknown> = {};
        for (const frame of stack) {
            for (const [key, val] of Object.entries(frame)) {
                merged[key] = val;
            }
        }
        return merged;
    },
} as const;
