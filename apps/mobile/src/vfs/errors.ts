/**
 * User-visible VFS/TDBC errors for the dev screen (CLI message parity, no exit codes).
 */
import {TdbcError, VfsError} from '@novel-master/core';

/**
 * Formats an error for on-screen display; mirrors {@link formatCliError} without CLI exit mapping.
 */
export function formatVfsError(error: unknown): string {
  if (error instanceof VfsError) {
    return error.message;
  }
  if (error instanceof TdbcError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
