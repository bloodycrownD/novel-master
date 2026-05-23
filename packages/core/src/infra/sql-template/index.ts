/**
 * SQL template parser: MyBatis-style dynamic SQL to prepared statements.
 *
 * Two-phase pipeline: {@link TemplateParser} (syntax → AST) then
 * {@link TemplateEvaluator} (AST + params → sql/parameters).
 */

export { SqlTemplateError } from "./errors.js";
export type { SqlTemplateErrorCode } from "./errors.js";
export type {
  AstNode,
  ForeachAttrs,
  ParseOptions,
  SqlParseResult,
  TrimAttrs,
} from "./types.js";
export { parseTemplateToAst, TemplateParser } from "./parser.js";
export {
  normalizeExpression,
  bindExpressionToContext,
  evaluateTest,
} from "./expression.js";
export type { EvaluateTestOptions } from "./expression.js";

import { TemplateEvaluator } from "./evaluator.js";
import { TemplateParser } from "./parser.js";
import type { ParseOptions, SqlParseResult } from "./types.js";

/**
 * Parses MyBatis-style dynamic SQL templates into SQL and bound parameters.
 */
export class SqlTemplateParser {
  private readonly parser = new TemplateParser();
  private readonly placeholder: string;

  /**
   * @param options - Optional placeholder character sequence for `#{...}` (default `?`).
   */
  constructor(options?: ParseOptions) {
    this.placeholder = options?.placeholder ?? "?";
  }

  /**
   * Parses `template` with `params` and returns final SQL plus ordered parameters.
   *
   * @param template - SQL template string with dynamic tags and `#{` / `${` placeholders.
   * @param params - Root binding context (missing properties resolve to `undefined`).
   * @remarks
   * `${name}` placeholders are interpolated as raw strings into the output SQL and are
   * **not** added to `parameters`. Only use `${...}` with trusted, validated values
   * (for example fixed column names from an allow-list). Untrusted input in `${...}`
   * can cause SQL injection. Prefer `#{name}` for user-supplied values.
   */
  parse(
    template: string,
    params: Record<string, unknown>,
  ): SqlParseResult {
    const ast = this.parser.parse(template);
    const evaluator = new TemplateEvaluator(this.placeholder);
    return evaluator.evaluate(ast, params);
  }
}
