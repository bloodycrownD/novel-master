/**
 * Session FS 回滚错误的结构守卫。
 *
 * 类与旧域短码联合已退役，构造统一
 * `new AppError("SESSION_FS_*", params)`（`this.name = key`）；守卫按 AppError
 * 的数字码落在 SESSION_FS 域段判中（116 段，域判定走 errors/domain.ts 的
 * domainOf，全仓唯一一份），保留 cause 链回溯（总纲 §7.2-3）。
 * {@link isSessionFsError} 本身保留（core 内部 message-rollback 消费）。
 *
 * @module errors/session-fs-errors
 */

import { isAppError, type AppError } from "@/errors/app-error.js";
import { domainOf } from "@/errors/domain.js";

function unwrapCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return error;
  }
  const withCause = error as { cause?: unknown };
  if (withCause.cause != null && withCause.cause !== error) {
    return unwrapCause(withCause.cause);
  }
  return error;
}

/** 结构守卫：AppError 且 `code` 落在 SESSION_FS 域段（116000-116999），沿 cause 链回溯。 */
export function isSessionFsError(error: unknown): error is AppError {
  const candidate = unwrapCause(error);
  return isAppError(candidate) && domainOf(candidate.code) === "SESSION_FS";
}

/** 判断是否为 revision 缺失需回补错误（含 cause 链）。 */
export function isRollbackRevisionBackfillRequiredError(error: unknown): error is AppError {
  return isAppError(unwrapCause(error), "SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED");
}

/** 从回补错误中读取缺失快照的逻辑路径列表（details.missingLogicalPaths，camelCase 供内部消费）。 */
export function readRollbackRevisionBackfillMissingPaths(error: unknown): readonly string[] {
  if (!isRollbackRevisionBackfillRequiredError(error)) {
    return [];
  }
  const details = (error as AppError).details as { missingLogicalPaths?: readonly string[] } | undefined;
  return details?.missingLogicalPaths ?? [];
}

/**
 * 判断错误是否可降级为仅截断消息（含 cause 链）。
 *
 * @remarks 当 error 或其 cause 链中存在 `SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED` 或
 * `SESSION_FS_ROLLBACK_UNDO_SEND_EMPTY_TARGET`（undo_send 无 baseline 且 live 树非空）时返回 true。
 */
export function isRollbackVfsDegradableError(error: unknown): boolean {
  return (
    isAppError(unwrapCause(error), "SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED") ||
    // undo_send 无 baseline：live 树非空时拒绝清空，上层可走「仅截断消息」降级
    isAppError(unwrapCause(error), "SESSION_FS_ROLLBACK_UNDO_SEND_EMPTY_TARGET")
  );
}
