/**
 * Message checkpoint capture port (Agent step boundary).
 *
 * @module service/message-checkpoint/message-checkpoint.port
 */

/**
 * Captures the session work tree after Agent mutating tools complete.
 */
export interface MessageCheckpointService {
  /**
   * Records `{ logicalPath → head_version }` for all session files.
   *
   * @remarks No-op when the work tree has zero files (optional per PRD).
   */
  capture(
    sessionId: string,
    projectId: string,
    messageId: string,
  ): Promise<void>;

  /**
   * 给「最后一个有 checkpoint 的消息之后」的空窗消息补 baseline 快照。
   *
   * 用途：Step 9 之前产生的历史消息可能没有 baseline，这里在事务内统一修补。
   * 已经有 checkpoint 的消息不会被覆盖；没有 message 或没有 live 文件时是空操作。
   *
   * @remarks 幂等：所有消息都有 checkpoint 时直接 short-circuit。
   */
  backfillMissingBaselines(
    sessionId: string,
    projectId: string,
  ): Promise<void>;
}
