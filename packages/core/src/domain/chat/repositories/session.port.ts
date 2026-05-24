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

  delete(id: string): Promise<boolean>;

  deleteByProject(projectId: string): Promise<void>;
}
