/**
 * User-visible VFS/TDBC errors for the dev screen (CLI message parity, no exit codes).
 */
import {TdbcError, VfsError} from '@novel-master/core';

/**
 * Formats an error for on-screen display; includes TdbcError cause when present.
 */
export function formatVfsError(error: unknown): string {
  if (error instanceof VfsError) {
    return error.message;
  }
  if (error instanceof TdbcError) {
    const inner = error.cause instanceof Error
      ? error.cause.message
      : error.cause != null
        ? String(error.cause)
        : undefined;
    return inner ? `${error.message}\n${inner}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
