/**
 * Desktop agent run: resolve agent/model, append user message, run AgentRunner (CLI/mobile parity).
 *
 * @module services/agent-run
 */
import {
  AgentRunResolveError,
  ChatAgentSession,
  createAgentRunner,
  parseApplicationModelId,
  registerVfsTools,
  resolveAgentToolRegistry,
  resolveApplicationModelIdForRun,
  resolveCurrentAgentDefinition as resolveCoreAgentDefinition,
  resolveCurrentAgentId as resolveCoreAgentId,
  textBlocks,
  ToolRegistry,
  validateAgentDefinition,
  type AgentDefinition,
  type AgentRunResult,
} from "@novel-master/core";
import {
  desktopLog,
  desktopLogError,
  desktopLogWarn,
  isDesktopLlmDebug,
} from "../log/desktop-log.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export interface AgentRunScope {
  readonly projectId: string;
  readonly sessionId: string;
}

export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunError";
  }
}

function mapResolveError<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (error instanceof AgentRunResolveError) {
      throw new AgentRunError(error.message);
    }
    throw error;
  });
}

export async function resolveCurrentAgentId(
  runtime: DesktopNovelMasterRuntime,
): Promise<string | undefined> {
  return resolveCoreAgentId(runtime);
}

export async function resolveCurrentAgentDefinition(
  runtime: DesktopNovelMasterRuntime,
): Promise<{ agentId: string; definition: AgentDefinition }> {
  return mapResolveError(() => resolveCoreAgentDefinition(runtime));
}

export async function resolveDesktopApplicationModelId(
  runtime: DesktopNovelMasterRuntime,
  definition: AgentDefinition,
): Promise<{ applicationModelId: string; workspaceModelId: string }> {
  return mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition),
  );
}

export async function runAgentTurn(
  runtime: DesktopNovelMasterRuntime,
  scope: AgentRunScope,
  userContent: string,
  options?: {
    readonly stream?: boolean;
    readonly allowResumeWithoutInput?: boolean;
    readonly signal?: AbortSignal;
    readonly onUserMessageAppended?: () => void | Promise<void>;
  },
): Promise<AgentRunResult> {
  let stage = "start";
  const stream = options?.stream !== false;
  const trimmed = userContent.trim();
  const allowResumeWithoutInput = options?.allowResumeWithoutInput === true;
  if (trimmed === "" && !allowResumeWithoutInput) {
    throw new AgentRunError("消息不能为空");
  }
  if (trimmed === "" && allowResumeWithoutInput) {
    stage = "resume-check-last-message";
    const list = await runtime.messages.listBySession(scope.sessionId);
    const last = list[list.length - 1];
    if (last?.role !== "user") {
      throw new AgentRunError("消息不能为空");
    }
  }

  const { definition } = await resolveCurrentAgentDefinition(runtime);
  stage = "resolve-model";
  const { applicationModelId, workspaceModelId } =
    await resolveDesktopApplicationModelId(runtime, definition);

  if (isDesktopLlmDebug()) {
    const { providerId, vendorModelId } =
      parseApplicationModelId(applicationModelId);
    try {
      const provider = await runtime.providers.get(providerId);
      desktopLog("agent-run start", {
        sessionId: scope.sessionId,
        projectId: scope.projectId,
        providerId,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        vendorModelId,
        applicationModelId,
        stream,
      });
    } catch (lookupError) {
      desktopLogWarn("agent-run provider lookup failed", {
        providerId,
        applicationModelId,
        err:
          lookupError instanceof Error
            ? lookupError.message
            : String(lookupError),
      });
    }
  }

  if (trimmed !== "") {
    stage = "append-user-message";
    const userMessage = await runtime.messages.append(
      scope.sessionId,
      "user",
      textBlocks(trimmed),
    );
    // WHY: user send is a rollback anchor for manual VFS edits made before the message.
    await runtime.messageCheckpoint.capture(
      scope.sessionId,
      scope.projectId,
      userMessage.id,
    );
    await options?.onUserMessageAppended?.();
  }

  stage = "validate-agent-definition";
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
    kind: "session",
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  await runtime.macroCache.refresh(scope.projectId, scope.sessionId, () =>
    wt.materialize(),
  );

  const runner = createAgentRunner({
    session,
    modelRequests: runtime.modelRequests,
    registry,
    toolCtx: {
      vfs,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    },
    messageCheckpoint: runtime.messageCheckpoint,
    regexConfig: runtime.regexConfig,
    listAllSessionMessages: () =>
      runtime.messages.listBySession(scope.sessionId),
    eventBus: runtime.eventBus,
    macroCache: runtime.macroCache,
    compactionConditions: runtime.compactionConditionEvaluator,
    eventOrchestrator: runtime.eventOrchestrator,
  });

  try {
    stage = "runner.run";
    return await runner.run({
      definition,
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      applicationModelId,
      workspaceModelId,
      maxSteps: definition.runtime?.maxSteps ?? 20,
      activeRegexGroupId,
      stream,
      signal: options?.signal,
    });
  } catch (error) {
    const err =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : { name: typeof error, message: String(error) };
    desktopLogError("agent-run failed", {
      stage,
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      applicationModelId,
      stream,
      err,
    });
    throw error;
  }
}
