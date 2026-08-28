/**
 * Human-readable tool output for LLM history and prompt preview.
 *
 * @module domain/tool/logic/format-tool-output
 */

import { formatVfsErrorForLlm } from "@/domain/vfs/logic/format-vfs-error-for-llm.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { ToolError } from "@/errors/tool-errors.js";
import { VfsError, isVfsError } from "@/errors/vfs-errors.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import type { ZodIssue } from "zod";

export type FormatToolErrorForLlmOptions = {
  readonly vfsScope?: VfsScope;
};

type GrepMatchShape = {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
};

function formatLineNumber(lineNum: number): string {
  return String(lineNum).padStart(6, " ");
}

/** Detects read tool output (including truncated). */
export function isReadOutput(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.path === "string" &&
    typeof rec.content === "string" &&
    typeof rec.totalLines === "number" &&
    typeof rec.returnedLines === "number" &&
    typeof rec.truncated === "boolean"
  );
}

/** Formats read output with 6-digit right-aligned line numbers. */
export function formatReadOutput(rec: Record<string, unknown>): string {
  const content = rec.content as string;
  const offset = typeof rec.offset === "number" ? rec.offset : 1;
  const lines = content.split("\n");
  const numbered = lines.map(
    (line, index) => `${formatLineNumber(offset + index)}|${line}`,
  );
  const parts = [numbered.join("\n")];

  if (rec.truncated === true) {
    const hints: string[] = ["Output truncated."];
    if (typeof rec.totalLines === "number") {
      hints.push(`Total lines: ${rec.totalLines}.`);
    }
    if (typeof rec.nextOffset === "number") {
      hints.push(`Continue with offset=${rec.nextOffset}.`);
    }
    parts.push(hints.join(" "));
  }

  return parts.join("\n\n");
}

/** Detects vfs grep tool output (excludes chat_grep). */
export function isGrepOutput(rec: Record<string, unknown>): boolean {
  if (
    !Array.isArray(rec.matches) ||
    typeof rec.total !== "number" ||
    typeof rec.truncated !== "boolean"
  ) {
    return false;
  }

  if (rec.matches.length === 0) {
    return !Array.isArray(rec.paths) && !Array.isArray(rec.entries);
  }

  const first = rec.matches[0];
  if (first == null || typeof first !== "object") {
    return false;
  }

  const match = first as Record<string, unknown>;
  if ("messageId" in match || "seq" in match || "hidden" in match) {
    return false;
  }

  return (
    typeof match.path === "string" &&
    typeof match.line === "number" &&
    typeof match.column === "number" &&
    typeof match.excerpt === "string"
  );
}

/** Formats grep matches as `path:line:column: excerpt` per line. */
export function formatGrepOutput(rec: Record<string, unknown>): string {
  const matches = rec.matches as readonly GrepMatchShape[];
  let out = matches
    .map((match) => `${match.path}:${match.line}:${match.column}: ${match.excerpt}`)
    .join("\n");

  if (rec.truncated === true) {
    const omitted =
      typeof rec.total === "number" ? rec.total - matches.length : undefined;
    const hint =
      omitted != null && omitted > 0
        ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).`
        : `\n\nOutput truncated (total ${rec.total}).`;
    out += hint;
  }

  return out;
}

/** Detects glob tool output. */
export function isGlobOutput(rec: Record<string, unknown>): boolean {
  return (
    Array.isArray(rec.paths) &&
    typeof rec.total === "number" &&
    typeof rec.truncated === "boolean" &&
    !Array.isArray(rec.entries) &&
    !Array.isArray(rec.matches)
  );
}

/** Formats glob paths one per line. */
export function formatGlobOutput(rec: Record<string, unknown>): string {
  const paths = rec.paths as readonly string[];
  let out = paths.join("\n");

  if (rec.truncated === true) {
    const omitted =
      typeof rec.total === "number" ? rec.total - paths.length : undefined;
    const hint =
      omitted != null && omitted > 0
        ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).`
        : `\n\nOutput truncated (total ${rec.total}).`;
    out += hint;
  }

  return out;
}

function isFsLsOutput(rec: Record<string, unknown>): boolean {
  return Array.isArray(rec.entries) && typeof rec.total === "number";
}

function formatFsLsOutput(rec: Record<string, unknown>): string {
  const entries = rec.entries as Array<{ path: string; kind: string }>;
  const lines = entries.map((e) => `${e.path}\t${e.kind}`);
  let out = lines.join("\n");
  if (rec.truncated === true) {
    const omitted =
      typeof rec.omitted === "number"
        ? rec.omitted
        : typeof rec.total === "number"
          ? rec.total - entries.length
          : 0;
    out += `\n\nOutput truncated (${omitted} entries omitted; total ${rec.total}).`;
  }
  return out;
}

/** Compact tool success text for the model (e.g. write → `ok`). */
export function formatToolOutputForLlm(out: unknown): string {
  if (typeof out === "string") {
    return out;
  }
  if (out != null && typeof out === "object" && !Array.isArray(out)) {
    const rec = out as Record<string, unknown>;
    const keys = Object.keys(rec);

    if (isReadOutput(rec)) {
      return formatReadOutput(rec);
    }

    if (isFsLsOutput(rec)) {
      return formatFsLsOutput(rec);
    }

    if (isGrepOutput(rec)) {
      return formatGrepOutput(rec);
    }

    if (isGlobOutput(rec)) {
      return formatGlobOutput(rec);
    }

    if (keys.length === 1 && typeof rec.version === "number") {
      return "ok";
    }
    if (
      keys.length === 2 &&
      typeof rec.version === "number" &&
      typeof rec.replacements === "number"
    ) {
      return "ok";
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
export function formatToolErrorForLlm(
  error: unknown,
  options?: FormatToolErrorForLlmOptions,
): string {
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
      message = formatToolErrorCause(error.cause, options?.vfsScope);
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


function resolveVfsErrorFromCause(cause: unknown): VfsError | undefined {
  if (cause instanceof TdbcError && cause.cause != null) {
    return resolveVfsErrorFromCause(cause.cause);
  }
  if (cause instanceof VfsError) {
    return cause;
  }
  if (isVfsError(cause)) {
    return cause as VfsError;
  }
  return undefined;
}

function formatToolErrorCause(
  cause: unknown,
  vfsScope?: VfsScope,
): string {
  const vfsError = resolveVfsErrorFromCause(cause);
  if (vfsError != null) {
    return formatVfsErrorForLlm(vfsError, vfsScope);
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
