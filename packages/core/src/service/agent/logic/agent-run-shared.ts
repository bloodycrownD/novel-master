/**
 * Shared agent-run resolve helpers for mobile and desktop runtimes.
 *
 * @module service/agent/logic/agent-run-shared
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { SessionAgentConfig } from "@/domain/chat/model/session-agent-config.js";
import { resolveSavedModelId } from "@/domain/agent/logic/resolve-saved-model-id.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";

/**
 * Agent run 共享的最小 runtime 表面。
 *
 * `sessions` 用来读会话级智能体配置（`SessionAgentConfig`），service 层保证
 * 列 NULL 已被 migration 回填，调用方拿到的永远是规范化后的对象。
 */
export interface AgentRunRuntimePort {
  readonly state: {
    getCurrentAgentId(): Promise<string | null | undefined>;
    getCurrentModelId(): Promise<string | null | undefined>;
  };
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
    get(agentId: string): Promise<AgentDefinition>;
  };
  readonly sessions: {
    getSessionAgentConfig(id: string): Promise<SessionAgentConfig>;
  };
}

export class AgentRunResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunResolveError";
  }
}

/** Resolves current agent id from state or registry fallback. */
export async function resolveCurrentAgentId(
  runtime: AgentRunRuntimePort,
): Promise<string | undefined> {
  const fromState = await runtime.state.getCurrentAgentId();
  if (fromState != null && fromState !== "") {
    return fromState;
  }
  const ids = await runtime.agentRegistry.listAgentIds();
  return ids[0];
}

/**
 * 新建会话时解析 workspace 当前 agentId：state 优先，缺失时回落 registry 首项。
 *
 * 与 {@link resolveCurrentAgentId} 同语义，只是入参收窄为 session service 实际
 * 持有的 `{ state, agentRegistry }` 形状（不强制要求 sessions 字段）。
 */
export async function resolveWorkspaceAgentForNewSession(deps: {
  readonly state: {
    getCurrentAgentId(): Promise<string | null | undefined>;
  };
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
  };
}): Promise<string | undefined> {
  const fromState = await deps.state.getCurrentAgentId();
  if (fromState != null && fromState !== "") {
    return fromState;
  }
  const ids = await deps.agentRegistry.listAgentIds();
  return ids[0];
}

/** Loads agent definition for the current agent pointer. */
export async function resolveCurrentAgentDefinition(
  runtime: AgentRunRuntimePort,
): Promise<{ agentId: string; definition: AgentDefinition }> {
  const agentId = await resolveCurrentAgentId(runtime);
  if (agentId == null || agentId === "") {
    throw new AgentRunResolveError(
      "未配置 Agent。请先在「agent管理」中导入或创建 Agent。",
    );
  }
  try {
    const definition = await runtime.agentRegistry.get(agentId);
    return { agentId, definition };
  } catch (error) {
    if (error instanceof AgentConfigError && error.code === "AGENT_NOT_FOUND") {
      throw new AgentRunResolveError(`Agent 不存在：${agentId}`);
    }
    throw error;
  }
}

/**
 * 解析对话 Agent 的 savedModelId（agent pin → session 覆盖）。
 *
 * workspace 层已移除：不再从 state.getCurrentModelId() 回退。返回的
 * `workspaceModelId` 仅用于下游压缩评估等消费方，由 state 读取后透传，
 * 不参与 savedModelId 解析优先级。
 */
export async function resolveApplicationModelIdForRun(
  runtime: AgentRunRuntimePort,
  definition: AgentDefinition,
  sessionId?: string,
): Promise<{ savedModelId: string; workspaceModelId: string }> {
  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? "";
  let sessionModelId: string | undefined;
  if (sessionId != null && sessionId !== "") {
    const sessionConfig = await runtime.sessions.getSessionAgentConfig(sessionId);
    // modelId 可选；空串归一化为 undefined（与 workspaceModelId 同约束）
    sessionModelId = sessionConfig.modelId || undefined;
  }
  const resolved = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId,
  });
  if (resolved == null || resolved === "") {
    throw new AgentRunResolveError(
      "未选择模型。请为 Agent 设置专属模型，或在会话上设置 modelId。",
    );
  }
  return { savedModelId: resolved, workspaceModelId };
}
