/**
 * Mobile agent run: resolve agent/model, append user message, run AgentRunner (CLI parity).
 */
import {
  AgentConfigError,
  ChatAgentSession,
  createAgentRunner,
  registerVfsTools,
  resolveAgentToolRegistry,
  resolveApplicationModelId,
  textBlocks,
  ToolRegistry,
  validateAgentDefinition,
  type AgentDefinition,
  type AgentRunResult,
} from '@novel-master/core';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export interface AgentRunScope {
  readonly projectId: string;
  readonly sessionId: string;
}

export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRunError';
  }
}

/** Resolves current agent id from state or registry fallback. */
export async function resolveCurrentAgentId(
  runtime: MobileNovelMasterRuntime,
): Promise<string | undefined> {
  const fromState = await runtime.state.getCurrentAgentId();
  if (fromState != null && fromState !== '') {
    return fromState;
  }
  const ids = await runtime.agentRegistry.listAgentIds();
  return ids[0];
}

/** Loads agent definition for the current agent pointer. */
export async function resolveCurrentAgentDefinition(
  runtime: MobileNovelMasterRuntime,
): Promise<{agentId: string; definition: AgentDefinition}> {
  const agentId = await resolveCurrentAgentId(runtime);
  if (agentId == null || agentId === '') {
    throw new AgentRunError(
      '未配置 Agent。请先在「Agent」页导入或创建 Agent。',
    );
  }
  try {
    const definition = await runtime.agentRegistry.get(agentId);
    return {agentId, definition};
  } catch (error) {
    if (error instanceof AgentConfigError && error.code === 'AGENT_NOT_FOUND') {
      throw new AgentRunError(`Agent 不存在：${agentId}`);
    }
    throw error;
  }
}

/** Resolves dialogue applicationModelId (agent pin → workspace current model). */
export async function resolveMobileApplicationModelId(
  runtime: MobileNovelMasterRuntime,
  definition: AgentDefinition,
): Promise<{applicationModelId: string; workspaceModelId: string}> {
  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
  const resolved = resolveApplicationModelId({
    agentModelId: definition.model,
    workspaceModelId: workspaceModelId || undefined,
  });
  if (resolved == null || resolved === '') {
    throw new AgentRunError(
      '未选择模型。请先选择工作区模型，或为 Agent 设置专属模型。',
    );
  }
  return {applicationModelId: resolved, workspaceModelId};
}

/**
 * Appends a user message and runs the agent loop (streaming via event bus).
 */
export async function runAgentTurn(
  runtime: MobileNovelMasterRuntime,
  scope: AgentRunScope,
  userContent: string,
  options?: {readonly stream?: boolean},
): Promise<AgentRunResult> {
  const stream = options?.stream !== false;
  const trimmed = userContent.trim();
  if (trimmed === '') {
    throw new AgentRunError('消息不能为空');
  }

  const {definition} = await resolveCurrentAgentDefinition(runtime);
  const {applicationModelId, workspaceModelId} =
    await resolveMobileApplicationModelId(runtime, definition);

  await runtime.messages.append(scope.sessionId, 'user', textBlocks(trimmed));

  const toolProbe = new ToolRegistry();
  registerVfsTools(toolProbe);
  await validateAgentDefinition(definition, {
    registeredToolNames: toolProbe.list(),
  });

  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  const registry = resolveAgentToolRegistry(toolProbe, definition);

  const session = new ChatAgentSession(runtime.messages, scope.sessionId);
  const activeRegexGroupId = await runtime.state.getCurrentRegexGroupId();
  const wt = runtime.worktree({
    kind: 'session',
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  await runtime.macroCache.refresh(scope.projectId, scope.sessionId, async () => {
    const [worktreeDisplay, filetreeDisplay] = await Promise.all([
      wt.renderDisplay(),
      wt.renderFileTree(),
    ]);
    return {worktreeDisplay, filetreeDisplay};
  });

  const runner = createAgentRunner({
    session,
    modelRequests: runtime.modelRequests,
    registry,
    toolCtx: {
      vfs,
      sessionFs: runtime.sessionFs,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    },
    regexConfig: runtime.regexConfig,
    listAllSessionMessages: () =>
      runtime.messages.listBySession(scope.sessionId),
    eventBus: runtime.eventBus,
    macroCache: runtime.macroCache,
    compactionConditions: runtime.compactionConditionEvaluator,
    eventOrchestrator: runtime.eventOrchestrator,
  });

  return runner.run({
    definition,
    sessionId: scope.sessionId,
    projectId: scope.projectId,
    applicationModelId,
    workspaceModelId,
    maxSteps: definition.runtime?.maxSteps ?? 20,
    activeRegexGroupId,
    stream,
  });
}
