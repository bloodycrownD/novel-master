/**
 * Project application service port.
 *
 * @module service/chat/project.port
 */

import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";
import type { ChatProject } from "@/domain/chat/model/project.js";
import type {
  ProjectAgentConfig,
  ProjectAgentConfigPatch,
} from "@/domain/chat/model/project-agent-config.js";

/** Project CRUD and copy operations. */
export interface ProjectService {
  list(): Promise<ChatProject[]>;

  get(id: string): Promise<ChatProject>;

  create(name: string): Promise<ChatProject>;

  rename(id: string, name: string): Promise<ChatProject>;

  delete(id: string): Promise<void>;

  /** Copies project metadata and project-domain template VFS only. */
  copy(id: string): Promise<ChatProject>;

  /** Overwrites project template VFS + worktree from global. */
  pullTemplate(projectId: string): Promise<void>;

  /** 读取项目智能体配置；列 NULL 时返回 `{ mode: "follow" }`。 */
  getAgentConfig(id: string): Promise<ProjectAgentConfig>;

  /** 合并 patch、校验并持久化项目智能体配置。 */
  updateAgentConfig(
    id: string,
    patch: ProjectAgentConfigPatch,
    options?: ValidateAgentDefinitionOptions,
  ): Promise<ProjectAgentConfig>;
}
