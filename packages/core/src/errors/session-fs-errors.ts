/**
 * Session FS 回滚错误的结构守卫（phase 1 双形态）。
 *
 * 类已退役，构造统一 `new AppError("SESSION_FS_*", params)`（`this.name = key`）；
 * 守卫保持结构判别 + cause 链回溯（总纲 §7.2-3），两种形态都认：
 * ① 旧形态：`name === "SessionFsError"` 且 `code` 是字符串短码（src/dist 双模块
 *    实例与过渡期在途对象）；② AppError 形态：`name` 以 `SESSION_FS_` 开头且
 *    `code` 是数字。不用 instanceof——测试环境存在双模块实例，会 false negative。
 *
 * @module errors/session-fs-errors
 */

import type { AppError } from "@/errors/app-error.js";

/** 域短码（守卫第二实参与跨端旧形态消费用；AppError 形态下对应 `SESSION_FS_` 前缀 key）。 */
export type SessionFsErrorCode =
  | "ROLLBACK_MESSAGE_NOT_FOUND"
  | "ROLLBACK_MESSAGE_SESSION_MISMATCH"
  | "ROLLBACK_NO_CHECKPOINT"
  | "RESTORE_REVISION_MISSING"
  | "ROLLBACK_VFS_RESTORE_FAILED"
  | "ROLLBACK_REVISION_BACKFILL_REQUIRED"
  // S-13 护栏：undo_send 解析出的 targetTree 为空时拒绝删除，
  // 避免在缺少 baseline checkpoint 的纯文本 chat 路径上把整个会话工作区删光。
  | "ROLLBACK_UNDO_SEND_EMPTY_TARGET"
  // A-22 乐观锁：resolveRollbackPlan 读快照与事务写入之间出现并发写入时拒绝，
  // 让上层重试或提示用户。重试上限耗尽后才向上抛这个错。
  | "ROLLBACK_CONFLICT"
  // CD-01 第 4 步：事务内 `seq > truncateAfterSeq` 的消息 id 集合与 plan 阶段
  // 记录的 tailMessageIds 不一致 —— 间隙里插进了 seq 更大的新消息，它会被
  // truncateTailInTransaction 连带截断，而用户从没回滚过它。
  | "ROLLBACK_TAIL_DRIFT";

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

/** 双形态守卫：AppError（key 前缀 `SESSION_FS_`）与旧形态（name + 字符串短码）都判中（含 cause 链）。 */
export function isSessionFsError(error: unknown, code?: SessionFsErrorCode): error is AppError {
  const candidate = unwrapCause(error);
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const err = candidate as { name?: unknown; code?: unknown };
  if (typeof err.name === "string" && err.name.startsWith("SESSION_FS_") && typeof err.code === "number") {
    return code === undefined || err.name === `SESSION_FS_${code}`;
  }
  return err.name === "SessionFsError" && typeof err.code === "string" && (code === undefined || err.code === code);
}

/** 判断是否为 revision 缺失需回补错误（含 cause 链）。 */
export function isRollbackRevisionBackfillRequiredError(error: unknown): error is AppError {
  return isSessionFsError(error, "ROLLBACK_REVISION_BACKFILL_REQUIRED");
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
 * @remarks 当 error 或其 cause 链中存在 `ROLLBACK_VFS_RESTORE_FAILED` 或
 * `ROLLBACK_UNDO_SEND_EMPTY_TARGET`（undo_send 无 baseline 且 live 树非空）时返回 true。
 */
export function isRollbackVfsDegradableError(error: unknown): boolean {
  return (
    isSessionFsError(error, "ROLLBACK_VFS_RESTORE_FAILED") ||
    // undo_send 无 baseline：live 树非空时拒绝清空，上层可走「仅截断消息」降级
    isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET")
  );
}
