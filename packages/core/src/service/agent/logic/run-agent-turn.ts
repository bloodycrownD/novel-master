/**
 * Shared "one chat turn" orchestration for mobile, desktop, and CLI parity.
 *
 * @module service/agent/logic/run-agent-turn
 */

import { resolveAgentToolRegistry } from "@/domain/agent/logic/resolve-agent-tool-registry.js";
import { validateAgentDefinition } from "@/domain/agent/logic/validate-agent-definition.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import { registerBuiltinTools } from "@/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { SessionWorktreeSnapshotStore } from "@/service/prompt/session-worktree-snapshot.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import { createAgentRunner } from "../create-agent-runner.js";
import { ChatAgentSession } from "../impl/chat-agent-session.js";
import {
  AgentRunResolveError,
  resolveApplicationModelIdForRun,
  resolveCurrentAgentDefinition,
  type AgentRunRuntimePort,
} from "./agent-run-shared.js";

export interface AgentTurnScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** Runtime surface required to run one agent dialogue turn. */
export interface AgentTurnRuntimePort extends AgentRunRuntimePort {
  readonly messages: MessageService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly modelRequests: ModelRequestService;
  readonly worktreeSnapshot: SessionWorktreeSnapshotStore;
  readonly eventBus: SimpleEventBus;
  readonly regexConfig: RegexConfigService;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  readonly eventOrchestrator: EventOrchestrator;
  readonly state: AgentRunRuntimePort["state"] & {
    getCurrentRegexGroupId(): Promise<string | null | undefined>;
  };
  sessionVfs(projectId: string, sessionId: string): VfsService;
  worktree(scope: VfsScope): WorktreeService;
}

export class AgentTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTurnError";
  }
}

export interface RunAgentTurnAfterResolveContext {
  readonly scope: AgentTurnScope;
  readonly definition: AgentDefinition;
  readonly applicationModelId: string;
  readonly workspaceModelId: string;
  readonly stream: boolean;
}

export interface RunAgentTurnOptions {
  readonly stream?: boolean;
  readonly allowResumeWithoutInput?: boolean;
  readonly signal?: AbortSignal;
  readonly onUserMessageAppended?: () => void | Promise<void>;
  /** When true, await checkpoint capture after user message (desktop). */
  readonly awaitMessageCheckpoint?: boolean;
  readonly onAfterResolveModel?: (
    ctx: RunAgentTurnAfterResolveContext,
  ) => void | Promise<void>;
  readonly onRunFailed?: (ctx: {
    readonly stage: string;
    readonly error: unknown;
    readonly scope: AgentTurnScope;
    readonly applicationModelId?: string;
    readonly stream: boolean;
  }) => void;
}

async function mapResolveError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AgentRunResolveError) {
      throw new AgentTurnError(error.message);
    }
    throw error;
  }
}

/**
 * Appends a user message (optional) and runs the agent loop (streaming via event bus).
 */
export async function runAgentTurn(
  runtime: AgentTurnRuntimePort,
  scope: AgentTurnScope,
  userContent: string,
  options?: RunAgentTurnOptions,
): Promise<AgentRunResult> {
  let stage = "start";
  const stream = options?.stream !== false;
  const trimmed = userContent.trim();
  const allowResumeWithoutInput = options?.allowResumeWithoutInput === true;
  if (trimmed === "" && !allowResumeWithoutInput) {
    throw new AgentTurnError("消息不能为空");
  }
  if (trimmed === "" && allowResumeWithoutInput) {
    stage = "resume-check-last-message";
    const list = await runtime.messages.listBySession(scope.sessionId);
    const last = list[list.length - 1];
    // WHY: only resume on trailing user turn to avoid consecutive assistant runs.
    if (last?.role !== "user") {
      throw new AgentTurnError("消息不能为空");
    }
  }

  const { definition } = await mapResolveError(() =>
    resolveCurrentAgentDefinition(runtime),
  );
  stage = "resolve-model";
  const { applicationModelId, workspaceModelId } = await mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition),
  );

  await options?.onAfterResolveModel?.({
    scope,
    definition,
    applicationModelId,
    workspaceModelId,
    stream,
  });

  if (trimmed !== "") {
    stage = "append-user-message";
    const userMessage = await runtime.messages.append(
      scope.sessionId,
      "user",
      textBlocks(trimmed),
    );
    // WHY: user send is a rollback anchor for manual VFS edits made before the message.
    const capture = runtime.messageCheckpoint.capture(
      scope.sessionId,
      scope.projectId,
      userMessage.id,
    );
    if (options?.awaitMessageCheckpoint === true) {
      await capture;
    } else {
      void capture.catch(() => undefined);
    }
    await options?.onUserMessageAppended?.();
  }

  stage = "validate-agent-definition";
  const toolProbe = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(toolProbe);
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
  await runtime.worktreeSnapshot.getOrRefresh(
    scope.projectId,
    scope.sessionId,
    async () => {
      const [worktreeDisplay, listRows] = await Promise.all([
        wt.renderDisplay(),
        wt.buildListRows(),
      ]);
      return { worktreeDisplay, listRows };
    },
  );

  const runner = createAgentRunner({
    session,
    modelRequests: runtime.modelRequests,
    registry,
    toolCtx: {
      vfs,
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      listSessionMessages: (): Promise<readonly ChatMessage[]> =>
        runtime.messages.listBySession(scope.sessionId),
    },
    messageCheckpoint: runtime.messageCheckpoint,
    regexConfig: runtime.regexConfig,
    listAllSessionMessages: (): Promise<readonly ChatMessage[]> =>
      runtime.messages.listBySession(scope.sessionId),
    eventBus: runtime.eventBus,
    worktreeSnapshot: runtime.worktreeSnapshot,
    worktree: runtime.worktree,
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
      activeRegexGroupId: activeRegexGroupId ?? undefined,
      stream,
      signal: options?.signal,
    });
  } catch (error) {
    options?.onRunFailed?.({
      stage,
      error,
      scope,
      applicationModelId,
      stream,
    });
    throw error;
  }
}
