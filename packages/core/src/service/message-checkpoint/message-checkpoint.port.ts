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
}
