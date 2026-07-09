/**
 * Shared agent-run resolve helpers for mobile and desktop runtimes.
 *
 * @module service/agent/logic/agent-run-shared
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import { resolveApplicationModelId } from "@/domain/agent/logic/resolve-application-model-id.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";

/** Minimal runtime surface for agent id / definition resolution. */
export interface AgentRunRuntimePort {
  readonly state: {
    getCurrentAgentId(): Promise<string | null | undefined>;
    getCurrentModelId(): Promise<string | null | undefined>;
  };
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
    get(agentId: string): Promise<AgentDefinition>;
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

/** Resolves dialogue savedModelId（cliModelId → agent pin → workspace current model）。 */
export async function resolveApplicationModelIdForRun(
  runtime: AgentRunRuntimePort,
  definition: AgentDefinition,
  cliModelId?: string,
): Promise<{ savedModelId: string; workspaceModelId: string }> {
  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? "";
  const resolved = resolveApplicationModelId({
    cliModelId,
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });
  if (resolved == null || resolved === "") {
    throw new AgentRunResolveError(
      "未选择模型。请先选择工作区模型，或为 Agent 设置专属模型。",
    );
  }
  return { savedModelId: resolved, workspaceModelId };
}
