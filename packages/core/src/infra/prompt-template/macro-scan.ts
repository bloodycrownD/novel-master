/**
 * Scans prompt template strings for `{{ ... }}` actions (comments and fields).
 *
 * @module infra/prompt-template/macro-scan
 */

import { PromptError } from "../../errors/prompt-errors.js";

export type MacroActionKind = "comment" | "dot" | "root";

export interface MacroAction {
  readonly kind: MacroActionKind;
  readonly start: number;
  readonly end: number;
  /** Dot path segments (e.g. `worktree`, `a`, `b`) or root key after `$`. */
  readonly path: readonly string[];
}

const UNSUPPORTED_PATTERN =
  /\b(if|range|with|template|define)\b|:=|\|/;

function assertSupportedSyntax(action: string, offset: number): void {
  if (UNSUPPORTED_PATTERN.test(action)) {
    throw new PromptError(
      "UNSUPPORTED_SYNTAX",
      `unsupported template syntax near offset ${offset}`,
      { offset },
    );
  }
}

function parseAction(action: string, openOffset: number): MacroAction {
  const trimmed = action.trim();
  if (trimmed.length === 0) {
    throw new PromptError("INVALID_YAML", "empty macro action", {
      offset: openOffset,
    });
  }

  if (trimmed.startsWith("/*")) {
    if (!trimmed.endsWith("*/")) {
      throw new PromptError("INVALID_YAML", "unclosed macro comment", {
        offset: openOffset,
      });
    }
    return { kind: "comment", start: openOffset, end: openOffset, path: [] };
  }

  assertSupportedSyntax(trimmed, openOffset);

  if (trimmed.startsWith(".")) {
    const path = trimmed
      .slice(1)
      .split(".")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (path.length === 0) {
      throw new PromptError("UNKNOWN_FIELD", "empty dot path", {
        offset: openOffset,
      });
    }
    return { kind: "dot", start: openOffset, end: openOffset, path };
  }

  if (trimmed.startsWith("$")) {
    const rest = trimmed.slice(1).trim();
    const key = rest.startsWith(".") ? rest.slice(1).trim() : rest;
    if (key.length === 0) {
      throw new PromptError("UNKNOWN_FIELD", "empty root field", {
        offset: openOffset,
      });
    }
    if (key.includes(".")) {
      throw new PromptError("UNKNOWN_FIELD", `unknown root field: $${key}`, {
        offset: openOffset,
      });
    }
    return { kind: "root", start: openOffset, end: openOffset, path: [key] };
  }

  throw new PromptError(
    "UNSUPPORTED_SYNTAX",
    `unsupported macro action: ${trimmed}`,
    { offset: openOffset },
  );
}

/**
 * Returns macro actions in source order (comments included for span removal).
 */
export function scanMacroActions(template: string): readonly MacroAction[] {
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
        throw new PromptError("INVALID_YAML", "unclosed macro comment", {
          offset: open,
        });
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
      throw new PromptError("INVALID_YAML", "unclosed macro", { offset: open });
    }

    const inner = template.slice(open + 2, close);
    const action = parseAction(inner, open);
    actions.push({ ...action, start: open, end: close + 2 });
    i = close + 2;
  }

  return actions;
}
