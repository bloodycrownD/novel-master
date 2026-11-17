/**
 * AppError 结构守卫统一入口（错误通道迁移「guards 统一」）。
 *
 * 「isAppError + 域判定 + cause 链回溯」统一走 {@link inDomain}，域守卫
 * {@link isVfsError} / {@link isSessionFsError} 是本文件里它的一行组合（原 VFS 域与
 * session-fs 域守卫模块已并入，域判定只有一个实现入口）；{@link domainOf} 段判定也
 * 在这里（spec-3 §3.7 的唯一实现，public/errors 从这里转发），段表
 * {@link DOMAIN_RANGES} 仍在 errors/domain.ts 全仓唯一一份。
 * {@link VfsReplaceNotFoundDetails} 是 edit REPLACE_NOT_FOUND 的 LCS 诊断字段
 * 类型（随 VFS 域守卫模块并入）。rollback 语义守卫自 session-fs 域守卫模块
 * 原样搬入（root-only unwrap 语义保留）。
 *
 * @module errors/guards
 */

import { isAppError, type AppError } from "@/errors/app-error.js";
import { DOMAIN_RANGES, type ErrorDomain } from "@/errors/domain.js";

export { isAppError };

/** 域守卫签名：收窄到 AppError，不收窄 key。 */
type AppErrorGuard = (e: unknown) => e is AppError;

/**
 * edit REPLACE_NOT_FOUND 时的 LCS 诊断字段。
 *
 * oldStringPreview / fileHintPreview 是双方前 100 字符的**原始文本**预览，
 * 由 formatter 以 JSON 转义形态展示——中文引号、HTML entity、换行/制表
 * 这类「肉眼看着一样或看不见」的差异会直接显形（`“` vs `"` vs `&ldquo;`、
 * `\n`/`\t`），且 LLM 可直接照抄修正 oldString（hex 码点无法反向消费，已退役）。
 * 设为可选，老的对象字面量构造路径不强制要求。
 */
export type VfsReplaceNotFoundDetails = {
  readonly oldStringLength: number;
  readonly longestCommonSubstring: string;
  readonly lcsLength: number;
  readonly lcsOccurrences: number;
  readonly oldStringPreview?: string;
  readonly fileHintPreview?: string;
};

/** 域判定唯一实现：按段表返回 code 归属的域。未登记的码只能来自编程错误（AppError 的 code 恒经码表产生），按不变量破坏 throw。 */
export function domainOf(code: number): ErrorDomain {
  const matched = (Object.entries(DOMAIN_RANGES) as readonly [ErrorDomain, readonly [number, number]][]).find(([, [lo, hi]]) => code >= lo && code <= hi);
  if (matched == null) {
    // nm-throw: keep — 码表外 code 属不变量破坏，返回 undefined 会让错误格式化静默走兜底
    throw new Error(`domainOf: 未登记的错误码 ${code}（码表外的 code 是不变量破坏）`);
  }
  return matched[0];
}

/**
 * 域守卫唯一组合：e 自身或 cause 链上任一环是 AppError 且 `code` 落在给定域段
 * 之一。域判定按段号而非 key 命名约定——语义属某域、前缀不同的 key 不会静默漏判。
 */
export function inDomain(e: unknown, ...domains: ErrorDomain[]): e is AppError {
  // 沿 cause 链逐环判中（自引用与环由 visited 拦住），任一环命中即 true。
  const visited = new Set<unknown>();
  let cur: unknown = e;
  while (typeof cur === "object" && cur !== null && !visited.has(cur)) {
    visited.add(cur);
    if (isAppError(cur) && domains.includes(domainOf(cur.code))) {
      return true;
    }
    cur = (cur as {cause?: unknown}).cause;
  }
  return false;
}

/**
 * 结构守卫：AppError 且 `code` 落在 VFS 域段（102000-103999），沿 cause 链回溯。
 *
 * nm-style: keep-public — VFS 域策略入口（inDomain 的 VFS 段位组合），service 多处
 * 生产调用 + 域测试直接引用；内联会把段位策略散到各调用点，不能撤导出。
 */
export const isVfsError: AppErrorGuard = (e) => inDomain(e, "VFS", "VFS_CHARACTER_CARD");

/** 结构守卫：AppError 且 `code` 落在 SESSION_FS 域段（116000-116999），沿 cause 链回溯。 */
export const isSessionFsError: AppErrorGuard = (e) => inDomain(e, "SESSION_FS");

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
