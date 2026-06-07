/**
 * Session file system service port (message rollback facade).
 *
 * @module service/session-fs/session-fs.port
 */

/**
 * Session-scoped rollback entry point (delegates to message checkpoint restore).
 */
export interface SessionFsService {
  /**
   * Restores the session workspace to the anchor message checkpoint tree (v2 forward-restore),
   * then deletes messages with `seq > anchor.seq` and tail checkpoints.
   *
   * Reconciles only paths in `tail checkpoint files ∪ target tree keys` — pre-anchor manual
   * VFS writes (FileEditor) stay unless a tail checkpoint touched the same path.
   * Anchor without its own checkpoint uses the nearest prior checkpoint tree (or empty baseline).
   */
  rollbackToMessage(
    sessionId: string,
    projectId: string,
    messageId: string,
  ): Promise<void>;
}
