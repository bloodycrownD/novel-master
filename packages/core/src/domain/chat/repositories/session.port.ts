/**
 * Chat session repository port.
 *
 * @module domain/chat/repositories/session.port
 */

import type { ChatSession } from "../model/session.js";

/** Persistence for `chat_session` rows. */
export interface SessionRepository {
  listByProject(projectId: string): Promise<ChatSession[]>;

  findById(id: string): Promise<ChatSession | null>;

  insert(session: ChatSession): Promise<void>;

  updateTitle(
    id: string,
    title: string,
    updatedAtMs: number,
  ): Promise<boolean>;

  delete(id: string): Promise<boolean>;

  deleteByProject(projectId: string): Promise<void>;

  /** 读取会话 `user_vfs_pending_json` 列；无行时返回 `null`。 */
  getUserVfsPendingJson(sessionId: string): Promise<string | null>;

  /** 写入或清空会话 `user_vfs_pending_json` 列。 */
  setUserVfsPendingJson(
    sessionId: string,
    json: string | null,
  ): Promise<boolean>;
}
