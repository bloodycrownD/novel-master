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
export { SqlTemplateParse, TemplateParser } from "./parser.js";
export { SqlTemplateExpression } from "./expression.js";
export type { EvaluateTestOptions } from "./expression.js";

import { Result } from "@/errors/either.js";
import { TemplateEvaluator } from "./evaluator.js";
import { TemplateParser } from "./parser.js";
import type { SqlTemplateError } from "./errors.js";
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
   * 失败沿 `Result.err` 携带 {@link SqlTemplateError}（码、offset、tagName 保持），
   * 不抛异常；reject 语义由 tdbc 桥（TdbcTemplate）统一转码。
   */
    parse(template: string, params: Record<string, unknown>): Result<SqlParseResult, SqlTemplateError> {
        const ast = this.parser.parse(template);
        if (!ast.ok) return Result.err(ast.error);
        const evaluator = new TemplateEvaluator(this.placeholder);
        return evaluator.evaluate(ast.value, params);
    }
}
