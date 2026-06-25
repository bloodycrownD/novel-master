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

  /** 读取 `agent_config_json` 列原始 JSON；未设置时为 null。 */
  getAgentConfig(id: string): Promise<string | null>;

  /** 写入 `agent_config_json` 列并更新 `updated_at_ms`；`configJson` 为 null 时清空列。 */
  updateAgentConfig(
    id: string,
    configJson: string | null,
    updatedAtMs: number,
  ): Promise<boolean>;

  delete(id: string): Promise<boolean>;
}
