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
 * `sessions` 用来读会话级智能体绑定（`SessionAgentConfig`），service 层已把
 * NULL 规约为 DEFAULT，调用方拿到的永远是规范化后的对象。
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
 * 解析对话 Agent 的 savedModelId（agent pin → session 覆盖 → workspace current model）。
 *
 * CLI-only 的 `cliModelId` 入参已在 chat-session-detail-page 迭代 Phase 0 移除；
 * core 只认 project/session/workspace 三层，CLI 自行兜底 flag 覆盖。
 *
 * 传 `sessionId` 时从会话绑定读取 `modelId`（仅 `bind` 模式存在），作为介于
 * agent pin 与 workspace 之间的中间层覆盖。`follow` 模式下不产生 sessionModelId。
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
    if (sessionConfig.mode === "bind") {
      // bind 模式下 modelId 可选；空串归一化为 undefined（与 workspaceModelId 同约束）
      sessionModelId = sessionConfig.modelId || undefined;
    }
  }
  const resolved = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId,
    workspaceModelId: workspaceModelId || undefined,
  });
  if (resolved == null || resolved === "") {
    throw new AgentRunResolveError(
      "未选择模型。请先选择工作区模型，或为 Agent 设置专属模型。",
    );
  }
  return { savedModelId: resolved, workspaceModelId };
}
