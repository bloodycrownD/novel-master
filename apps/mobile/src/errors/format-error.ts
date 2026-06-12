/**
 * User-visible error messages for Core domain errors (VFS, chat, provider, tools, agent).
 */
import {
  AgentError,
  ChatError,
  CloudSyncError,
  ProviderError,
  SessionFsError,
  TdbcError,
  ToolError,
  VfsError,
  VfsZipError,
} from '@novel-master/core';

function formatCause(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (cause != null) {
    return String(cause);
  }
  return undefined;
}

function readCause(error: Error): unknown {
  return (error as Error & {cause?: unknown}).cause;
}

/** Formats an error for on-screen display; unwraps known Core error types. */
export function formatError(error: unknown): string {
  if (
    error instanceof VfsError ||
    error instanceof VfsZipError ||
    error instanceof ProviderError ||
    error instanceof ChatError ||
    error instanceof AgentError ||
    error instanceof SessionFsError ||
    error instanceof CloudSyncError
  ) {
    return error.message;
  }
  if (error instanceof ToolError) {
    const cause = formatCause(readCause(error));
    return cause ? `${error.message}\n${cause}` : error.message;
  }
  if (error instanceof TdbcError) {
    const inner = formatCause(readCause(error));
    return inner ? `${error.message}\n${inner}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** @deprecated Prefer {@link formatError}; kept for VFS call sites. */
export function formatVfsError(error: unknown): string {
  return formatError(error);
}
