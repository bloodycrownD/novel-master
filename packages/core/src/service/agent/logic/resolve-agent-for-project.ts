/**
 * 按项目 + 会话解析运行时 Agent 定义。
 *
 * 解析优先级（自顶向下，命中即返回）：
 * 1. **project custom**：项目级自定义 definition 直接返回（截断，不读 session）。
 * 2. **project follow → session.agentId**：会话始终独立持有 agentId，去 registry
 *    取 definition 返回。session.agentId 不存在时抛 `AgentRunResolveError`。
 *
 * workspace 层已移除：不再有「session follow 回退 workspace」分支。
 *
 * @module service/agent/logic/resolve-agent-for-project
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ProjectService } from "@/service/chat/project.port.js";
import {
  AgentRunResolveError,
  type AgentRunRuntimePort,
} from "./agent-run-shared.js";

/**
 * 项目域 Agent 解析结果；runner 仅消费 definition。
 *
 * - `project-custom`：项目 custom 截断，**不含** agentId（与 model pin 一致）。
 * - `session`：project follow + 会话独立 agentId → registry 取 definition。
 */
export type ResolvedAgentForProject =
  | {
      readonly source: "session";
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
 * 读取项目 + 会话智能体配置并解析为运行时 Agent 定义。
 *
 * - **project custom**：使用列内 `definition`，**不含** synthetic `agentId`。
 *   截断会话配置——custom 模式下 session.agentId 不生效。
 * - **project follow**：用 `session.agentId` 去 registry 取 definition，
 *   返回 `{ source: "session", agentId, definition }`。
 *   registry 不存在该 agentId 时抛 `AgentRunResolveError`。
 *
 * @breaking `sessionId` 在 chat-session-detail-page 迭代由可选升为必填，
 * 所有调用点（core 内 `run-agent-turn.ts` + apps 6 处）需同步透传。
 */
export async function resolveAgentForProject(
  runtime: ResolveAgentForProjectRuntimePort,
  projectId: string,
  sessionId: string,
): Promise<ResolvedAgentForProject> {
  const config = await runtime.projects.getAgentConfig(projectId);
  // project custom 截断：不读 session，直接用项目内联 definition。
  if (config.mode === "custom") {
    if (config.definition == null) {
      throw new AgentRunResolveError(
        "项目智能体配置无效：custom 模式缺少 definition。",
      );
    }
    return { source: "project-custom", definition: config.definition };
  }

  // project follow：会话独立持有 agentId，去 registry 取 definition。
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
  const agentId = sessionConfig.agentId;
  try {
    const definition = await runtime.agentRegistry.get(agentId);
    return { source: "session", agentId, definition };
  } catch (error) {
    // registry.get 抛 AGENT_NOT_FOUND 时归一化为 AgentRunResolveError，
    // 保留原始错误消息便于诊断。
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentRunResolveError(
      `会话引用的 Agent 不存在：${agentId}（${detail}）`,
    );
  }
}
