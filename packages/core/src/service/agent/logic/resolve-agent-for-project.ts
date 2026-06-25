/**
 * 按项目解析运行时 Agent 定义（follow → 全局；custom → 项目专属）。
 *
 * @module service/agent/logic/resolve-agent-for-project
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ProjectService } from "@/service/chat/project.port.js";
import {
  AgentRunResolveError,
  resolveCurrentAgentDefinition,
  type AgentRunRuntimePort,
} from "./agent-run-shared.js";

/** 项目域 Agent 解析结果；runner 仅消费 definition。 */
export type ResolvedAgentForProject =
  | {
      readonly source: "global";
      readonly agentId: string;
      readonly definition: AgentDefinition;
    }
  | {
      readonly source: "project-custom";
      readonly definition: AgentDefinition;
    };

/** {@link resolveAgentForProject} 所需 runtime 表面。 */
export interface ResolveAgentForProjectRuntimePort extends AgentRunRuntimePort {
  readonly projects: ProjectService;
}

/**
 * 读取项目智能体配置并解析为运行时 Agent 定义。
 *
 * - `follow`：委托 {@link resolveCurrentAgentDefinition}，含 `agentId`
 * - `custom`：使用列内 `definition`，**不含** synthetic `agentId`
 */
export async function resolveAgentForProject(
  runtime: ResolveAgentForProjectRuntimePort,
  projectId: string,
): Promise<ResolvedAgentForProject> {
  const config = await runtime.projects.getAgentConfig(projectId);
  if (config.mode === "follow") {
    const { agentId, definition } = await resolveCurrentAgentDefinition(runtime);
    return { source: "global", agentId, definition };
  }
  if (config.definition == null) {
    throw new AgentRunResolveError(
      "项目智能体配置无效：custom 模式缺少 definition。",
    );
  }
  return { source: "project-custom", definition: config.definition };
}
