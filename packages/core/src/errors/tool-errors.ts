/**
 * Tool error model: typed, machine-readable error codes for tool dispatch.
 *
 * @module errors/tool-errors
 */

import type { ZodIssue } from "zod";

/** Discriminant codes for {@link ToolError}. */
export type ToolErrorCode =
  /** Tool name is not registered. */
  | "NOT_FOUND"
  /** Tool name is already registered. */
  | "CONFLICT"
  /** Tool input failed schema validation. */
  | "INVALID_ARGUMENT"
  /** Tool execution failed (including output contract violations). */
  | "FAILED"
  /** Tool input was rejected by path policy (A-14). */
  | "FORBIDDEN";

export type ToolErrorDetails =
  | { readonly issues: readonly ZodIssue[] }
  | Record<string, unknown>;

/**
 * Unified error for tool registration, validation, and execution.
 *
 * @remarks
 * `ToolRunner` normalizes errors into `ToolError` so callers can reliably branch
 * on `code`. When wrapping an underlying failure, the original error is kept as
 * `cause`.
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly toolName?: string;
  readonly details?: ToolErrorDetails;

  constructor(
    code: ToolErrorCode,
    message: string,
    options?: {
      toolName?: string;
      details?: ToolErrorDetails;
      cause?: unknown;
    },
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    super(message, options?.cause !== undefined ? { cause: options.cause } : {});
    this.name = "ToolError";
    this.code = code;
    this.toolName = options?.toolName;
    this.details = options?.details;
  }
}

/** Tool name is not registered. */
export function toolNotFound(name: string): ToolError {
  return new ToolError("NOT_FOUND", `Tool not registered: ${name}`, {
    toolName: name,
  });
}

/** Reject duplicate tool registration. */
export function toolConflict(name: string): ToolError {
  return new ToolError("CONFLICT", `Tool already registered: ${name}`, {
    toolName: name,
  });
}

/** Tool input schema validation failed. */
export function toolInvalidArgument(
  name: string,
  issues: readonly ZodIssue[],
): ToolError {
  return new ToolError("INVALID_ARGUMENT", `Invalid input for tool: ${name}`, {
    toolName: name,
    details: { issues },
  });
}

/** Tool execution failed; preserves the original error as `cause`. */
export function toolFailed(name: string, cause: unknown): ToolError {
  return new ToolError("FAILED", `Tool failed: ${name}`, {
    toolName: name,
    cause,
  });
}

/**
 * Tool input was rejected by path policy (A-14).
 *
 * @remarks
 * `ToolRunner` 在 schema 校验通过之后、真正调 tool 之前会做一次 path 白名单
 * 二次校验；只要 input 里的路径不在 `allowedPaths` 任一前缀下就抛这个。
 */
export function toolPathForbidden(name: string, path: string): ToolError {
  return new ToolError(
    "FORBIDDEN",
    `Tool path outside allowed scope: ${name} -> ${path}`,
    {
      toolName: name,
      details: { path },
    },
  );
}

