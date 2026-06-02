/**
 * Lightweight Go-style field macro replacement for text block content.
 *
 * @module infra/prompt-template/macro-render
 */

import { PromptError } from "../../errors/prompt-errors.js";
import { scanMacroActions } from "./macro-scan.js";

export interface MacroRenderContext {
  readonly dot: Readonly<Record<string, unknown>>;
  readonly root: Readonly<Record<string, string>>;
  /** Dot fields that resolve to "" when missing. */
  readonly optionalDotFields?: readonly string[];
}

function lookupDot(
  dot: Readonly<Record<string, unknown>>,
  path: readonly string[],
  offset: number,
  optionalTopLevel?: ReadonlySet<string>,
): string {
  if (
    path.length === 1 &&
    optionalTopLevel?.has(path[0]!) === true
  ) {
    const value = dot[path[0]!];
    if (value == null) {
      return "";
    }
    if (typeof value !== "string") {
      return "";
    }
    return value;
  }
  let current: unknown = dot;
  for (const segment of path) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) {
      throw new PromptError(
        "UNKNOWN_FIELD",
        `unknown field: .${path.join(".")}`,
        { offset },
      );
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current == null) {
    throw new PromptError(
      "UNKNOWN_FIELD",
      `unknown field: .${path.join(".")}`,
      { offset },
    );
  }
  if (typeof current !== "string") {
    throw new PromptError(
      "UNKNOWN_FIELD",
      `field .${path.join(".")} is not a string`,
      { offset },
    );
  }
  return current;
}

function lookupRoot(
  root: Readonly<Record<string, string>>,
  key: string,
  offset: number,
): string {
  const value = root[key];
  if (value == null) {
    throw new PromptError("UNKNOWN_FIELD", `unknown field: $.${key}`, { offset });
  }
  return value;
}

/**
 * Replaces `{{ ... }}` macros in `template` using dot and root contexts.
 */
export function renderMacro(
  template: string,
  ctx: MacroRenderContext,
): string {
  const actions = scanMacroActions(template);
  if (actions.length === 0) {
    return template;
  }

  const optionalTopLevel =
    ctx.optionalDotFields != null
      ? new Set(ctx.optionalDotFields)
      : undefined;

  let out = "";
  let cursor = 0;

  for (const action of actions) {
    out += template.slice(cursor, action.start);

    if (action.kind === "comment") {
      cursor = action.end;
      continue;
    }

    if (action.kind === "dot") {
      out += lookupDot(ctx.dot, action.path, action.start, optionalTopLevel);
    } else {
      out += lookupRoot(ctx.root, action.path[0]!, action.start);
    }

    cursor = action.end;
  }

  out += template.slice(cursor);
  return out;
}
