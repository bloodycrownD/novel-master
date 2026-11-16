/**
 * AppError 结构守卫统一入口（错误通道迁移「guards 统一」）。
 *
 * 「isAppError + 域判定 + cause 链回溯」此前在 isVfsError / isSessionFsError
 * 各写一遍，现收进本文件：域判定唯一走 {@link inDomain}（isVfsError /
 * isSessionFsError 在各自模块退化成它的一行组合），key 判定的对偶是
 * {@link isAppErrorWithKey}；{@link domainOf} 段判定也随迁到这里（spec-3 §3.7
 * 的唯一实现，public/errors 从这里转发），段表 {@link DOMAIN_RANGES} 仍在
 * errors/domain.ts 全仓唯一一份。rollback 语义守卫自 session-fs-errors.ts
 * 原样搬入（root-only unwrap 语义保留）。
 *
 * @module errors/guards
 */

import { isAppError, type AppError } from "@/errors/app-error.js";
import { DOMAIN_RANGES, type ErrorDomain } from "@/errors/domain.js";
import type { ErrorKey } from "@/errors/error-codes.js";

export { isAppError };

/** 域守卫签名：收窄到 AppError，不收窄 key（key 判定走 {@link isAppErrorWithKey}）。 */
export type AppErrorGuard = (e: unknown) => e is AppError;

/** 域判定唯一实现：按段表返回 code 归属的域。未登记的码只能来自编程错误（AppError 的 code 恒经码表产生），按不变量破坏 throw。 */
export function domainOf(code: number): ErrorDomain {
  const matched = (Object.entries(DOMAIN_RANGES) as readonly [ErrorDomain, readonly [number, number]][]).find(([, [lo, hi]]) => code >= lo && code <= hi);
  if (matched == null) {
    throw new Error(`domainOf: 未登记的错误码 ${code}（码表外的 code 是不变量破坏）`);
  }
  return matched[0];
}

/** 沿 cause 链逐环判中（自引用与环由 visited 拦住），任一环命中即 true。 */
function someCauseLink(e: unknown, hit: (link: unknown) => boolean): boolean {
  const visited = new Set<unknown>();
  let cur: unknown = e;
  while (typeof cur === "object" && cur !== null && !visited.has(cur)) {
    visited.add(cur);
    if (hit(cur)) {
      return true;
    }
    cur = (cur as {cause?: unknown}).cause;
  }
  return false;
}

/**
 * 域守卫唯一组合：e 自身或 cause 链上任一环是 AppError 且 `code` 落在给定域段
 * 之一。域判定按段号而非 key 命名约定——语义属某域、前缀不同的 key 不会静默漏判。
 */
export function inDomain(e: unknown, ...domains: ErrorDomain[]): e is AppError {
  return someCauseLink(e, (link) => isAppError(link) && domains.includes(domainOf(link.code)));
}

/** key 守卫（inDomain 的 key 侧对偶）：e 自身或 cause 链上任一环是 AppError 且 key 命中。 */
// nm-style: keep-public — guards 统一点名要求的守卫工具面（inDomain 的 key 侧对偶），
// 与 inDomain 构成域/key 两个方向的成对 API；当前 rollback 守卫按 ask 保留 root-only
// 函数体未迁移，是后续把它们收成一行组合时的判定底座。
export function isAppErrorWithKey<K extends ErrorKey>(e: unknown, key: K): e is AppError<K> {
  return someCauseLink(e, (link) => isAppError(link, key));
}

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
