/**
 * Message-level workspace rollback port.
 *
 * @module service/message-checkpoint/message-rollback.port
 */

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
  ): Promise<void>;
}
