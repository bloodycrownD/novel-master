/**
 * Scans prompt template strings for `{{ ... }}` actions (comments and fields).
 *
 * @module infra/prompt-template/macro-scan
 */

import { AppError } from "../../errors/app-error.js";
import { Result } from "../../errors/either.js";

export type MacroActionKind = "comment" | "dot" | "root";

export interface MacroAction {
  readonly kind: MacroActionKind;
  readonly start: number;
  readonly end: number;
  /** Dot path segments (e.g. `worktree`, `a`, `b`) or root key after `$`. */
  readonly path: readonly string[];
}

const UNSUPPORTED_PATTERN = /\b(if|range|with|template|define)\b|:=|\|/;

function parseAction(action: string, openOffset: number): Result<MacroAction, AppError> {
  const trimmed = action.trim();
  if (trimmed.length === 0) {
    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "empty macro action", offset: openOffset }));
  }

  if (trimmed.startsWith("/*")) {
    if (!trimmed.endsWith("*/")) {
      return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro comment", offset: openOffset }));
    }
    return Result.ok({ kind: "comment", start: openOffset, end: openOffset, path: [] });
  }

  if (UNSUPPORTED_PATTERN.test(trimmed)) {
    return Result.err(new AppError("PROMPT_UNSUPPORTED_SYNTAX", { detail: `unsupported template syntax near offset ${openOffset}`, offset: openOffset }));
  }

  if (trimmed.startsWith(".")) {
    const path = trimmed.slice(1).split(".").map((s) => s.trim()).filter((s) => s.length > 0);
    if (path.length === 0) {
      return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: "empty dot path", offset: openOffset }));
    }
    return Result.ok({ kind: "dot", start: openOffset, end: openOffset, path });
  }

  if (trimmed.startsWith("$")) {
    const rest = trimmed.slice(1).trim();
    const key = rest.startsWith(".") ? rest.slice(1).trim() : rest;
    if (key.length === 0) {
      return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: "empty root field", offset: openOffset }));
    }
    if (key.includes(".")) {
      return Result.err(new AppError("PROMPT_UNKNOWN_FIELD", { detail: `unknown root field: $${key}`, offset: openOffset }));
    }
    return Result.ok({ kind: "root", start: openOffset, end: openOffset, path: [key] });
  }

  return Result.err(new AppError("PROMPT_UNSUPPORTED_SYNTAX", { detail: `unsupported macro action: ${trimmed}`, offset: openOffset }));
}

/**
 * Returns macro actions in source order (comments included for span removal);
 * 残缺/非法模板是用户内容错误，沿 `Result.err` 回传，不抛。
 */
export function scanMacroActions(template: string): Result<readonly MacroAction[], AppError> {
  const actions: MacroAction[] = [];
  let i = 0;

  while (i < template.length) {
    const open = template.indexOf("{{", i);
    if (open < 0) {
      break;
    }

    if (template.startsWith("{{/*", open)) {
      const close = template.indexOf("*/}}", open + 4);
      if (close < 0) {
        return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro comment", offset: open }));
      }
      const end = close + 4;
      actions.push({
        kind: "comment",
        start: open,
        end,
        path: [],
      });
      i = end;
      continue;
    }

    const close = template.indexOf("}}", open + 2);
    if (close < 0) {
      return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "unclosed macro", offset: open }));
    }

    const inner = template.slice(open + 2, close);
    const parsed = parseAction(inner, open);
    if (!parsed.ok) {
      return Result.err(parsed.error);
    }
    actions.push({ ...parsed.value, start: open, end: close + 2 });
    i = close + 2;
  }

  return Result.ok(actions);
}
