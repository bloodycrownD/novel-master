/**
 * CLI error formatting and exit codes.
 *
 * @module cli-errors
 */

import { TdbcError } from "@novel-master/core";
import { AppError } from "@novel-master/core/agent";
import { SkspError } from "@novel-master/core/sksp";
import { userMessageOf } from "@novel-master/core/i18n";
import { coreT } from "./i18n.js";

export const EXIT_USAGE = 1;
const EXIT_RUNTIME = 2;

/** 错误 → 用户可见中文文案：i18n 后 descriptor 模式的 message 是英文 desc，边界统一解析。 */
function visibleMessage(error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error);
  const descriptor = userMessageOf(error);
  return descriptor != null ? coreT(descriptor) : fallback;
}

export function formatCliError(error: unknown): string {
  // per-domain 类已退役（统一 AppError），TdbcError / SkspError 不在本期范围。
  if (error instanceof AppError || error instanceof TdbcError || error instanceof SkspError) {
    return visibleMessage(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof Error && error.message.startsWith("Usage:")) {
    return EXIT_USAGE;
  }
  return EXIT_RUNTIME;
}
