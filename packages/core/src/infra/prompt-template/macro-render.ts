/**
 * Lightweight Go-style field macro replacement for text block content.
 *
 * @module infra/prompt-template/macro-render
 */

import { AppError } from "../../errors/app-error.js";
import { Result } from "../../errors/either.js";
import { scanMacroActions } from "./macro-scan.js";

interface MacroRenderContext {
  readonly dot: Readonly<Record<string, unknown>>;
  readonly root: Readonly<Record<string, string>>;
  /** Dot fields that resolve to "" when missing. */
  readonly optionalDotFields?: readonly string[];
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

    let resolved: string;
    if (action.kind === "dot") {
      if (action.path.length === 1 && optionalTopLevel?.has(action.path[0]!) === true) {
        const value = ctx.dot[action.path[0]!];
        resolved = value == null || typeof value !== "string" ? "" : value;
      } else {
        let current: unknown = ctx.dot;
        for (const segment of action.path) {
          if (current == null || typeof current !== "object" || Array.isArray(current)) {
            return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: .${action.path.join(".")}`, offset: action.start }));
          }
          current = (current as Record<string, unknown>)[segment];
        }
        if (current == null) {
          return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: .${action.path.join(".")}`, offset: action.start }));
        }
        if (typeof current !== "string") {
          return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `field .${action.path.join(".")} is not a string`, offset: action.start }));
        }
        resolved = current;
      }
    } else {
      const value = ctx.root[action.path[0]!];
      if (value == null) {
        return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown field: $.${action.path[0]!}`, offset: action.start }));
      }
      resolved = value;
    }
    out += resolved;

    cursor = action.end;
  }

  out += template.slice(cursor);
  return Result.ok(out);
}
