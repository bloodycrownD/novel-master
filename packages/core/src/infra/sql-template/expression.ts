/**
 * MyBatis-style `test` expression normalization and evaluation via `__ctx__` proxy.
 */

import { SqlTemplateError } from "./errors.js";
import type { ContextStack } from "./context.js";
import { mergedContextForExpression } from "./context-proxy.js";

const FORBIDDEN_PATTERN = /[;{}]|=>|\bfunction\b|\bnew\b|\beval\b|\bimport\b/i;

const RESERVED_WORDS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "instanceof",
  "in",
  "void",
  "delete",
]);

const IDENTIFIER_RE = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\b/g;

/**
 * Converts MyBatis logical keywords to JavaScript operators (whole-word only).
 */
export function normalizeExpression(expr: string): string {
  return expr
    .trim()
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .replace(/\bnot\b/gi, "!");
}

/**
 * Rewrites bare identifiers to `__ctx__.path` for evaluation in a single scope.
 */
export function bindExpressionToContext(expr: string): string {
  return expr.replace(IDENTIFIER_RE, (match) => {
    const lower = match.toLowerCase();
    if (RESERVED_WORDS.has(lower)) return match;
    const parts = match.split(".");
    let bound = `__ctx__.${parts[0]}`;
    for (let i = 1; i < parts.length; i++) {
      bound += `?.${parts[i]}`;
    }
    return bound;
  });
}

/**
 * Evaluates a `test` expression against the current context stack.
 * Missing properties read as `undefined` via a chained Proxy.
 */
export function evaluateTest(expr: string, stack: ContextStack): boolean {
  const normalized = bindExpressionToContext(normalizeExpression(expr));
  if (!normalized) {
    throw new SqlTemplateError("EXPRESSION_ERROR", "Empty test expression");
  }
  if (FORBIDDEN_PATTERN.test(normalized)) {
    throw new SqlTemplateError(
      "EXPRESSION_ERROR",
      `Disallowed syntax in test expression: ${expr}`,
    );
  }

  const ctx = mergedContextForExpression(stack);
  try {
    const fn = new Function("__ctx__", `return (${normalized});`);
    return Boolean(fn(ctx));
  } catch (err) {
    throw new SqlTemplateError(
      "EXPRESSION_ERROR",
      `Failed to evaluate test expression: ${expr}`,
      { cause: err },
    );
  }
}
