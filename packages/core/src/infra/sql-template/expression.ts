/**
 * MyBatis-style `test` expression normalization and evaluation via `__ctx__` proxy.
 */

import { SqlTemplateError } from "./errors.js";
import type { ContextStack } from "./context.js";
import { mergedContextForExpression } from "./context-proxy.js";

const FORBIDDEN_PATTERN =
  /[;{}]|=>|\bfunction\b|\bnew\b|\beval\b|\bimport\b|\bconstructor\b/i;

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
 * `new Function` 编译缓存：相同表达式体复用同一个已编译函数。
 *
 * `new Function` 在 V8 里会触发即时编译，单次开销不小。AgentRunner 主循环里
 * 同一个 `test` 表达式往往会被反复求值（每轮 foreach 迭代、每个 when 分支），
 * 每次都重新 `new Function` 是纯浪费。这里按规范化后的表达式体做 key 缓存
 * 编译结果，命中后直接拿现成函数去跑就行。
 */
const compiledTestFunctionCache = new Map<
  string,
  (ctx: unknown) => unknown
>();

function compileTestFunction(normalized: string): (ctx: unknown) => unknown {
  const cached = compiledTestFunctionCache.get(normalized);
  if (cached !== undefined) return cached;
  const fn = new Function("__ctx__", `return (${normalized});`) as (
    ctx: unknown,
  ) => unknown;
  compiledTestFunctionCache.set(normalized, fn);
  return fn;
}

/**
 * Applies `transform` only to segments outside single- and double-quoted literals.
 */
function mapOutsideStringLiterals(
  expr: string,
  transform: (segment: string) => string,
): string {
  let result = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      while (i < expr.length) {
        if (expr[i] === "\\") {
          i += 2;
          continue;
        }
        if (expr[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      result += expr.slice(start, i);
      continue;
    }
    let end = i;
    while (end < expr.length && expr[end] !== "'" && expr[end] !== '"') {
      end++;
    }
    result += transform(expr.slice(i, end));
    i = end;
  }
  return result;
}

/**
 * Converts MyBatis logical keywords to JavaScript operators (whole-word only).
 * Keywords inside string literals are left unchanged.
 */
export function normalizeExpression(expr: string): string {
  const trimmed = expr.trim();
  return mapOutsideStringLiterals(trimmed, (segment) =>
    segment
      .replace(/\band\b/gi, "&&")
      .replace(/\bor\b/gi, "||")
      .replace(/\bnot\b/gi, "!"),
  );
}

/**
 * Rewrites bare identifiers to `__ctx__.path` for evaluation in a single scope.
 * Identifiers inside string literals are left unchanged.
 */
export function bindExpressionToContext(expr: string): string {
  return mapOutsideStringLiterals(expr, (segment) =>
    segment.replace(IDENTIFIER_RE, (match) => {
      const lower = match.toLowerCase();
      if (RESERVED_WORDS.has(lower)) return match;
      const parts = match.split(".");
      let bound = `__ctx__.${parts[0]}`;
      for (let i = 1; i < parts.length; i++) {
        bound += `?.${parts[i]}`;
      }
      return bound;
    }),
  );
}

export interface EvaluateTestOptions {
  /** Template offset of the `test` attribute value, when known. */
  offset?: number;
}

/**
 * Evaluates a `test` expression against the current context stack.
 * Missing properties read as `undefined` via a chained Proxy.
 */
export function evaluateTest(
  expr: string,
  stack: ContextStack,
  options?: EvaluateTestOptions,
): boolean {
  const normalized = bindExpressionToContext(normalizeExpression(expr));
  const errorOptions = options?.offset !== undefined
    ? { offset: options.offset }
    : undefined;
  if (!normalized) {
    throw new SqlTemplateError(
      "EXPRESSION_ERROR",
      "Empty test expression",
      errorOptions,
    );
  }
  if (FORBIDDEN_PATTERN.test(normalized)) {
    throw new SqlTemplateError(
      "EXPRESSION_ERROR",
      `Disallowed syntax in test expression: ${expr}`,
      errorOptions,
    );
  }

  const ctx = mergedContextForExpression(stack);
  try {
    const fn = compileTestFunction(normalized);
    return Boolean(fn(ctx));
  } catch (err) {
    throw new SqlTemplateError(
      "EXPRESSION_ERROR",
      `Failed to evaluate test expression: ${expr}`,
      { ...errorOptions, cause: err },
    );
  }
}
