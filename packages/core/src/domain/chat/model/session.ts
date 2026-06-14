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
  /** 用户 VFS pending 队列 JSON；`null` 表示无 pending。 */
  readonly userVfsPendingJson: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
