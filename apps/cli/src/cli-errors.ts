/**
 * CLI error formatting and exit codes.
 *
 * @module cli-errors
 */

import { AppError, isAppError } from "@novel-master/core/agent";
import { TdbcError } from "@novel-master/core";
import { SkspError } from "@novel-master/core/sksp";
import { userMessageOf } from "@novel-master/core/i18n";
import type { Outcome } from "@novel-master/core/workplace";
import { coreT } from "./i18n.js";

export const EXIT_USAGE = 1;
const EXIT_RUNTIME = 2;
/** SIGINT 惯例：用户取消 / 任务被替换 → 130（cancelled 管线统一出口，spec-3 §3.5）。 */
export const EXIT_CANCELLED = 130;
/** cancelled 管线统一文案：Outcome.cancelled/replaced 与 TOOL_CANCELLED 都只打这一行，不打印错误文案。 */
export const CANCELLED_MESSAGE = "已取消";
/** 命令函数 `Outcome<void>` 的完成分支（run* 的非中断 return 共用）。 */
export const OUTCOME_COMPLETED: Outcome<void> = { kind: "completed", value: undefined };

/** 错误 → 用户可见中文文案：i18n 后 descriptor 模式的 message 是英文 desc，边界统一解析。 */
function visibleMessage(error: Error): string {
  const descriptor = userMessageOf(error);
  return descriptor != null ? coreT(descriptor) : error.message;
}

export function formatCliError(error: unknown): string {
  // AppError 走码表 messageKey；TdbcError / SkspError 是 infra 保留类（spec-3 §3.2
  // 第 7 条口径：cli 有入口，经 userMessageOf 沿 cause 翻译，不拼 cause、不加分支——
  // SkspError 无 messageKey，输出与直出 message 逐字一致，T-A7 基线锁）。
  if (error instanceof AppError || error instanceof TdbcError || error instanceof SkspError) {
    return visibleMessage(error);
  }
  return error instanceof Error ? error.message : String(error);
}

export function exitCodeForError(error: unknown): number {
  // 工具取消保留 throw 协议（spec-2 §2.2 路径二），按专用码判别 → 130。
  if (isAppError(error, "TOOL_CANCELLED")) return EXIT_CANCELLED;
  if (error instanceof Error && error.message.startsWith("Usage:")) return EXIT_USAGE;
  return EXIT_RUNTIME;
}
