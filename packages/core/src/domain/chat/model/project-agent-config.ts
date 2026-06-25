/**
 * 项目智能体配置（存于 `chat_project.agent_config_json` 列）。
 *
 * @module domain/chat/model/project-agent-config
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/** 项目智能体策略模式。 */
export type ProjectAgentMode = "follow" | "custom";

/** 持久化在 `chat_project.agent_config_json` 列内的文档。 */
export interface ProjectAgentConfig {
  readonly mode: ProjectAgentMode;
  /** `mode === "custom"` 时必填；`follow` 时可保留草稿。 */
  readonly definition?: AgentDefinition;
}

/** {@link ProjectService.updateAgentConfig} 的部分更新。 */
export interface ProjectAgentConfigPatch {
  readonly mode?: ProjectAgentMode;
  readonly definition?: AgentDefinition;
}

/** 列 NULL 或未设置时的默认配置。 */
export const DEFAULT_PROJECT_AGENT_CONFIG: ProjectAgentConfig = {
  mode: "follow",
};
