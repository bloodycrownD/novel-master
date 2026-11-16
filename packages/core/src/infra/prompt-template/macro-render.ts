/**
 * Lightweight Go-style field macro replacement for text block content.
 *
 * @module infra/prompt-template/macro-render
 */

import { AppError } from "../../errors/app-error.js";
import { Result } from "../../errors/either.js";
import { scanMacroActions } from "./macro-scan.js";

export interface MacroRenderContext {
  readonly dot: Readonly<Record<string, unknown>>;
  readonly root: Readonly<Record<string, string>>;
  /** Dot fields that resolve to "" when missing. */
  readonly optionalDotFields?: readonly string[];
}

function lookupDot(dot: Readonly<Record<string, unknown>>, path: readonly string[], offset: number, optionalTopLevel?: ReadonlySet<string>): Result<string, AppError> {
  if (path.length === 1 && optionalTopLevel?.has(path[0]!) === true) {
    const value = dot[path[0]!];
    if (value == null || typeof value !== "string") {
      return Result.ok("");
    }
    return Result.ok(value);
  }
  let current: unknown = dot;
  for (const segment of path) {
    if (
      current == null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: .${path.join(".")}`, offset }));
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current == null) {
    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: .${path.join(".")}`, offset }));
  }
  if (typeof current !== "string") {
    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `field .${path.join(".")} is not a string`, offset }));
  }
  return Result.ok(current);
}

function lookupRoot(root: Readonly<Record<string, string>>, key: string, offset: number): Result<string, AppError> {
  const value = root[key];
  if (value == null) {
    return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: $.${key}`, offset }));
  }
  return Result.ok(value);
}

/**
 * Replaces `{{ ... }}` macros in `template` using dot and root contexts;
 * 模板引用了不存在的字段是用户内容错误，沿 `Result.err` 回传，不抛。
 */
export function renderMacro(template: string, ctx: MacroRenderContext): Result<string, AppError> {
  const scanned = scanMacroActions(template);
  if (!scanned.ok) {
    return Result.err(scanned.error);
  }
  const actions = scanned.value;
  if (actions.length === 0) {
    return Result.ok(template);
  }

  const optionalTopLevel = ctx.optionalDotFields != null ? new Set(ctx.optionalDotFields) : undefined;

  let out = "";
  let cursor = 0;

  for (const action of actions) {
    out += template.slice(cursor, action.start);

    if (action.kind === "comment") {
      cursor = action.end;
      continue;
    }

    const value = action.kind === "dot" ? lookupDot(ctx.dot, action.path, action.start, optionalTopLevel) : lookupRoot(ctx.root, action.path[0]!, action.start);
    if (!value.ok) {
      return Result.err(value.error);
    }
    out += value.value;

    cursor = action.end;
  }

  out += template.slice(cursor);
  return Result.ok(out);
}
