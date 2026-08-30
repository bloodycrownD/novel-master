/**
 * 按项目 + 会话解析运行时 Agent 定义。
 *
 * 项目智能体功能已下线：所有项目统一走 session 级智能体选择。
 * 会话始终独立持有 agentId，去 registry 取 definition 返回；
 * session.agentId 不存在时抛 `AgentRunResolveError`。
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
 * 项目智能体已下线，只剩 session 分支：会话独立 agentId → registry 取 definition。
 */
export type ResolvedAgentForProject = {
  readonly source: "session";
  readonly agentId: string;
  readonly definition: AgentDefinition;
};

/** {@link resolveAgentForProject} 所需 runtime 表面。 */
export interface ResolveAgentForProjectRuntimePort extends AgentRunRuntimePort {
  readonly projects: ProjectService;
}

/**
 * 读取会话智能体配置并解析为运行时 Agent 定义。
 *
 * 项目智能体已下线：不再读取 `chat_project.agent_config_json`，
 * 所有项目统一走 session 级——用 `session.agentId` 去 registry 取 definition，
 * 返回 `{ source: "session", agentId, definition }`。
 * registry 不存在该 agentId 时抛 `AgentRunResolveError`。
 *
 * @breaking `sessionId` 在 chat-session-detail-page 迭代由可选升为必填，
 * 所有调用点（core 内 `run-agent-turn.ts` + apps 多处）需同步透传。
 */
export async function resolveAgentForProject(
  runtime: ResolveAgentForProjectRuntimePort,
  projectId: string,
  sessionId: string
): Promise<ResolvedAgentForProject> {
  void projectId;
  void runtime.projects;
  // 会话独立持有 agentId，去 registry 取 definition。
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
      `会话引用的 Agent 不存在：${agentId}（${detail}）`
    );
  }
}
