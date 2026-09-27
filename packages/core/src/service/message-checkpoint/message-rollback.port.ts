/**
 * Message-level workspace rollback port.
 *
 * @module service/message-checkpoint/message-rollback.port
 */

/** 回滚可选参数。 */
export type RollbackOptions = {
  /** 跳过 VFS reconcile，仅截断 tail 消息与 checkpoint。 */
  readonly skipVfsReconcile?: boolean;
  /** 对缺失 revision 的 path 用 live head 回补后再 reconcile。 */
  readonly revisionHeadBackfill?: boolean;
};

/**
 * 回滚链分段打点探针（rollback-large-jank Step 1）。
 *
 * core 是跨端包没有 `__DEV__` 全局，门控由注入方负责（mobile 在 runtime
 * 装配时仅 __DEV__ 注入，desktop/cli 不注入 → 恒 no-op）。detail 只在探针
 * 存在时求值（调用方以 `if (probe != null)` 包裹），未注入时零开销。
 */
export type RollbackProbe = (
  label: string,
  detail?: Record<string, number | string>
) => void;

/**
 * Restores the session work tree to an anchor message checkpoint and truncates tail messages.
 */
export interface MessageRollbackService {
  /**
   * Rolls back to `anchorMessageId`: forward-restore file tree, delete tail messages/checkpoints, GC revisions.
   */
  rollbackToMessage(
    sessionId: string,
    projectId: string,
    anchorMessageId: string,
    options?: RollbackOptions
  ): Promise<void>;
}
