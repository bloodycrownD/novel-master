/**
 * Shared agent-run resolve helpers for mobile and desktop runtimes.
 *
 * @module service/agent/logic/agent-run-shared
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { SessionAgentConfig } from "@/domain/chat/model/session-agent-config.js";
import { AppError, isAppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import type { Result } from "@/errors/either.js";

/**
 * Agent run 共享的最小 runtime 表面。
 *
 * `sessions` 用来读会话级智能体配置（`SessionAgentConfig`），service 层保证
 * 列 NULL 已被 migration 回填，调用方拿到的永远是规范化后的对象（会话不存在
 * 走 `Result.err`，NULL 不变量破坏仍 throw）。
 */
export interface AgentRunRuntimePort {
  readonly state: {
    getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
    getCurrentModelId(): Promise<Result<string | undefined, AppError>>;
  };
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
    get(agentId: string): Promise<AgentDefinition>;
  };
  readonly sessions: {
    getSessionAgentConfig(id: string): Promise<Result<SessionAgentConfig, AppError>>;
  };
}

/**
 * agent run resolve 链的失败形态（AgentRunResolveError 退役后的判别集合）：
 * 核心侧 {@link resolveCurrentAgentDefinition} / {@link resolveApplicationModelIdForRun} /
 * `resolveAgentForProject` 与双端 mapResolveError、meta 归一 catch 共用同一口径。
 */
export const AGENT_RUN_RESOLVE_KEYS: ReadonlySet<ErrorKey> = new Set<ErrorKey>([
  "AGENT_NOT_CONFIGURED",
  "AGENT_NOT_FOUND",
  "AGENT_MODEL_NOT_SET",
  "AGENT_REFERENCED_NOT_FOUND",
]);

/** Resolves current agent id from state or registry fallback. */
export async function resolveCurrentAgentId(
  runtime: AgentRunRuntimePort
): Promise<string | undefined> {
  const fromState = await runtime.state.getCurrentAgentId();
  if (!fromState.ok) throw fromState.error;
  if (fromState.value != null && fromState.value !== "") {
    return fromState.value;
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
    getCurrentAgentId(): Promise<Result<string | undefined, AppError>>;
  };
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
  };
}): Promise<string | undefined> {
  const fromState = await deps.state.getCurrentAgentId();
  if (!fromState.ok) throw fromState.error;
  if (fromState.value != null && fromState.value !== "") {
    return fromState.value;
  }
  const ids = await deps.agentRegistry.listAgentIds();
  return ids[0];
}

/** Loads agent definition for the current agent pointer. */
export async function resolveCurrentAgentDefinition(
  runtime: AgentRunRuntimePort
): Promise<{ agentId: string; definition: AgentDefinition }> {
  const agentId = await resolveCurrentAgentId(runtime);
  if (agentId == null || agentId === "") {
    throw new AppError("AGENT_NOT_CONFIGURED");
  }
  try {
    const definition = await runtime.agentRegistry.get(agentId);
    return { agentId, definition };
  } catch (error) {
    if (isAppError(error, "AGENT_NOT_FOUND")) {
      throw new AppError("AGENT_NOT_FOUND", {agentId});
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
  * 解包 throw 边界（错误通道迁移三期门⑦）：runtime.sessions 的 `Result` 失败原样上抛——Result → agent run 异常通道转码点，由 agent turn loop / 调用端点 catch 收口。
 */
export async function resolveApplicationModelIdForRun(
  runtime: AgentRunRuntimePort,
  definition: AgentDefinition,
  sessionId?: string
): Promise<{ savedModelId: string; workspaceModelId: string }> {
  const currentModel = await runtime.state.getCurrentModelId();
  if (!currentModel.ok) throw currentModel.error;
  const workspaceModelId = currentModel.value ?? "";
  let sessionModelId: string | undefined;
  if (sessionId != null && sessionId !== "") {
    const sessionConfig = await runtime.sessions.getSessionAgentConfig(
      sessionId
    );
    if (!sessionConfig.ok) throw sessionConfig.error;
    // modelId 可选；空串归一化为 undefined（与 workspaceModelId 同约束）
    sessionModelId = sessionConfig.value.modelId || undefined;
  }
  const resolved = definition.model ?? sessionModelId;
  if (resolved == null || resolved === "") {
    throw new AppError("AGENT_MODEL_NOT_SET");
  }
  return { savedModelId: resolved, workspaceModelId };
}
