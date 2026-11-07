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
import { userMessageOf } from "@novel-master/core/i18n";
import { coreT } from "./i18n.js";

export const EXIT_USAGE = 1;
export const EXIT_RUNTIME = 2;

/** 错误 → 用户可见中文文案：i18n 后 descriptor 模式的 message 是英文 desc，边界统一解析。 */
function visibleMessage(error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error);
  const descriptor = userMessageOf(error);
  return descriptor != null ? coreT(descriptor) : fallback;
}

export function formatCliError(error: unknown): string {
  if (error instanceof AppError) {
    return visibleMessage(error);
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
    return visibleMessage(error);
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
