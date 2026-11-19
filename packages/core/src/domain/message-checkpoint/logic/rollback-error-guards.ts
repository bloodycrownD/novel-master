/**
 * Session 回滚专用错误守卫：按 key 判定 AppError，沿 cause 链回溯到链尾。
 *
 * 三个 key（116006 / 116007 / 116008）与 `details.missingLogicalPaths` 的读法是
 * SESSION_FS 回滚域自己的知识——检测侧由 `MissingRevisions.findPointers` 产出
 * missing 列表，降级语义由 restore-path 承载；判定住在本域，通用域判定仍走
 * errors/guards.ts 的 `domainOf` / `inDomain`。
 *
 * @module domain/message-checkpoint/logic/rollback-error-guards
 */

import { isAppError } from "@/errors/app-error.js";

export const RollbackErrorGuards = {
  /** 取 cause 链链尾；visited 拦住自引用与多节点环，环上停在重复进入的节点。 */
  unwrapCause(error: unknown): unknown {
    const visited = new Set<unknown>();
    let cur: unknown = error;
    while (typeof cur === "object" && cur !== null && !visited.has(cur)) {
      visited.add(cur);
      const next = (cur as {cause?: unknown}).cause;
      if (next == null) return cur;
      cur = next;
    }
    return cur;
  },

  /**
   * 判断是否为 revision 缺失需回补错误（含 cause 链）；判的是链尾，不收窄外层对象。
   *
   * nm-style: keep-public — mobile 回滚确认流的跨包公共入口（public/session-fs 转发），不能内联。
   */
  isRevisionBackfillRequired(error: unknown): boolean {
    return isAppError(RollbackErrorGuards.unwrapCause(error), "SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED");
  },

  /**
   * 从回补错误链尾读取缺失快照的逻辑路径列表（details.missingLogicalPaths，camelCase 供内部消费）。
   *
   * nm-style: keep-public — mobile 回补确认流读取缺失路径的跨包公共入口（public/session-fs 转发），不能内联。
   */
  readRevisionBackfillMissingPaths(error: unknown): readonly string[] {
    const target = RollbackErrorGuards.unwrapCause(error);
    if (!isAppError(target, "SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED")) return [];
    const details = target.details as { missingLogicalPaths?: readonly string[] } | undefined;
    return details?.missingLogicalPaths ?? [];
  },

  /**
   * 判断错误是否可降级为仅截断消息（含 cause 链）。
   *
   * @remarks 当 error 或其 cause 链中存在 `SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED` 或
   * `SESSION_FS_ROLLBACK_UNDO_SEND_EMPTY_TARGET`（undo_send 无 baseline 且 live 树非空）时返回 true。
   *
   * nm-style: keep-public — mobile 回滚降级分支的跨包公共入口（public/session-fs 转发），不能内联。
   */
  isVfsDegradable(error: unknown): boolean {
    return (
      isAppError(RollbackErrorGuards.unwrapCause(error), "SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED") ||
      // undo_send 无 baseline：live 树非空时拒绝清空，上层可走「仅截断消息」降级
      isAppError(RollbackErrorGuards.unwrapCause(error), "SESSION_FS_ROLLBACK_UNDO_SEND_EMPTY_TARGET")
    );
  },
} as const;
