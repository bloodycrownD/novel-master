/**
 * Session application service port.
 *
 * @module service/chat/session.port
 */

import type { ChatSession } from "@/domain/chat/model/session.js";

/** Session CRUD, template copy on create, and full copy. */
export interface SessionService {
  listByProject(projectId: string): Promise<ChatSession[]>;

  get(id: string): Promise<ChatSession>;

  /** Creates session and copies project template VFS into session domain. */
  create(projectId: string, title?: string | null): Promise<ChatSession>;

  delete(id: string): Promise<void>;

  /** Copies session VFS tree and all messages to a new session. */
  copy(id: string): Promise<ChatSession>;

  /**
   * Overwrites session VFS + worktree from project template;
   * clears session-fs data but not messages.
   */
  pullTemplate(sessionId: string): Promise<void>;
}
