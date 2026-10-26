/**
 * CLI error formatting and exit codes.
 *
 * @module cli-errors
 */

import { TdbcError } from "@novel-master/core";


import { AppError } from "@novel-master/core/agent";


import { PromptError } from "@novel-master/core/prompt";


import { ProviderError } from "@novel-master/core/provider";


import { SessionFsError } from "@novel-master/core/session-fs";


import { VfsError, VfsZipError } from "@novel-master/core/vfs";
import { SkspError } from "@novel-master/core/sksp";

export const EXIT_USAGE = 1;
export const EXIT_RUNTIME = 2;

export function formatCliError(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (
    error instanceof VfsError ||
    error instanceof VfsZipError ||
    error instanceof PromptError ||
    error instanceof TdbcError ||
    error instanceof ProviderError ||
    error instanceof SessionFsError ||
    error instanceof SkspError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof AppError) {
    return EXIT_RUNTIME;
  }
  if (
    error instanceof VfsError ||
    error instanceof VfsZipError ||
    error instanceof PromptError ||
    error instanceof TdbcError ||
    error instanceof ProviderError ||
    error instanceof SessionFsError ||
    error instanceof SkspError
  ) {
    return EXIT_RUNTIME;
  }
  if (error instanceof Error && error.message.startsWith("Usage:")) {
    return EXIT_USAGE;
  }
  return EXIT_RUNTIME;
}
