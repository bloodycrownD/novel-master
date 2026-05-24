/**
 * Project application service port.
 *
 * @module service/chat/project.port
 */

import type { ChatProject } from "../../domain/chat/model/project.js";

/** Project CRUD and copy operations. */
export interface ProjectService {
  list(): Promise<ChatProject[]>;

  get(id: string): Promise<ChatProject>;

  create(name: string): Promise<ChatProject>;

  delete(id: string): Promise<void>;

  /** Copies project metadata and project-domain template VFS only. */
  copy(id: string): Promise<ChatProject>;
}
