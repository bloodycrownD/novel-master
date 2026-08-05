/**
 * Chat session model.
 *
 * @module domain/chat/model/session
 */

/** A conversation session within a project. */
export interface ChatSession {
  readonly id: string;
  readonly projectId: string;
  readonly title: string | null;
  /**
   * 父 session id；主会话为 null，子 agent 会话指向派生它的主会话。
   *
   * 见 SPEC agent-subagent：子 session 只用于落消息历史，VFS 不独立建 scope。
   */
  readonly parentSessionId: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
