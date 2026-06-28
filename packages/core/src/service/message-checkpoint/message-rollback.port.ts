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
    options?: RollbackOptions,
  ): Promise<void>;
}
