/**
 * Human-readable tool output for LLM history and prompt preview.
 *
 * @module domain/tool/logic/format-tool-output
 */

import { ToolError } from "@/errors/tool-errors.js";
import { VfsError } from "@/errors/vfs-errors.js";
import type { ZodIssue } from "zod";

/** Compact tool success text for the model (e.g. write → `ok`). */
export function formatToolOutputForLlm(out: unknown): string {
  if (typeof out === "string") {
    return out;
  }
  if (out != null && typeof out === "object" && !Array.isArray(out)) {
    const rec = out as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 1 && typeof rec.version === "number") {
      return "ok";
    }
    if (
      keys.length === 2 &&
      typeof rec.version === "number" &&
      typeof rec.replacements === "number"
    ) {
      const n = rec.replacements;
      return n === 1 ? "ok" : `ok (${n} replacements)`;
    }
    if (keys.length === 1 && rec.ok === true) {
      return "ok";
    }
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Formats tool execution failures for LLM `tool_result` content.
 *
 * @remarks Unwraps {@link ToolError} `cause` (e.g. {@link VfsError}) so the model sees actionable detail.
 */
export function formatToolErrorForLlm(error: unknown): string {
  let message: string;
  if (error instanceof ToolError) {
    if (
      error.code === "INVALID_ARGUMENT" &&
      error.details != null &&
      "issues" in error.details
    ) {
      const issues = error.details.issues as readonly ZodIssue[];
      const summary = issues.map((i) => i.message).join("; ");
      message = summary.length > 0 ? summary : error.message;
    } else if (error.cause != null) {
      message = formatToolErrorCause(error.cause);
    } else {
      message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return `Error: ${message}`;
}

function formatToolErrorCause(cause: unknown): string {
  if (cause instanceof VfsError) {
    return cause.message;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/** Prettify stored tool_result bodies (legacy rows may still be JSON). */
export function formatToolResultContentForDisplay(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("Error:")) {
    return content;
  }
  try {
    return formatToolOutputForLlm(JSON.parse(trimmed) as unknown);
  } catch {
    return content;
  }
}
