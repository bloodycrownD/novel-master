/**
 * Chat project repository port.
 *
 * @module domain/chat/repositories/project.port
 */

import type { ChatProject } from "../model/project.js";

/** Persistence for `chat_project` rows. */
export interface ProjectRepository {
  list(): Promise<ChatProject[]>;

  findById(id: string): Promise<ChatProject | null>;

  insert(project: ChatProject): Promise<void>;

  updateName(id: string, name: string, updatedAtMs: number): Promise<boolean>;

  delete(id: string): Promise<boolean>;
}
