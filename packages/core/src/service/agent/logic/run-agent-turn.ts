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
import type {
  ChatMessage,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { SessionWorktreeSnapshotStore } from "@/service/prompt/session-worktree-snapshot.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { ProjectService } from "@/service/chat/project.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import { isUserVfsUnifiedToolTurnEnabled } from "@/domain/feature-flags/user-vfs-unified-tool-turn.js";
import { createAgentRunner } from "../create-agent-runner.js";
import { ChatAgentSession } from "../impl/chat-agent-session.js";
import { DEFAULT_AGENT_MAX_STEPS } from "./agent-run-max-steps.js";
import { assembleAgentRunnerDeps } from "./assemble-agent-runner-deps.js";
import {
  AgentRunResolveError,
  resolveApplicationModelIdForRun,
  type AgentRunRuntimePort,
} from "./agent-run-shared.js";
import { resolveAgentForProject } from "./resolve-agent-for-project.js";

export interface AgentTurnScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** Runtime surface required to run one agent dialogue turn. */
export interface AgentTurnRuntimePort extends AgentRunRuntimePort {
  readonly projects: ProjectService;
  readonly messages: MessageService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly modelRequests: ModelRequestService;
  readonly savedModelRepo: SavedModelRepository;
  readonly worktreeSnapshot: SessionWorktreeSnapshotStore;
  readonly eventBus: SimpleEventBus;
  readonly regexConfig: RegexConfigService;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  readonly eventOrchestrator: EventOrchestrator;
  /** 用户 VFS U-A-U-A 落库；发送成功路径 flush 前置。 */
  readonly userVfsTurn?: UserVfsTurnService;
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
  readonly savedModelId: string;
  readonly workspaceModelId: string;
  readonly stream: boolean;
}

export interface RunAgentTurnOptions {
  readonly stream?: boolean;
  readonly allowResumeWithoutInput?: boolean;
  readonly signal?: AbortSignal;
  readonly onUserMessageAppended?: () => void | Promise<void>;
  readonly onAfterResolveModel?: (
    ctx: RunAgentTurnAfterResolveContext,
  ) => void | Promise<void>;
  readonly onRunFailed?: (ctx: {
    readonly stage: string;
    readonly error: unknown;
    readonly scope: AgentTurnScope;
    readonly savedModelId?: string;
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

/** 空续跑时暂存的末条 user，flush 后写回以免 UUA。 */
export interface TrailingUserSnapshot {
  readonly content: MessageContent;
  readonly raw: ChatMessage["raw"];
}

/**
 * flush 前若 pending 非空、空续跑且末条为 user，暂存并删除该条；flush 后再 append 写回。
 * pending 为空时 flush 为 no-op，不重排末条 user。
 */
export async function flushPendingUserVfsTurnsWithTrailingUserReorder(
  runtime: Pick<AgentTurnRuntimePort, "messages" | "userVfsTurn">,
  sessionId: string,
  trimmed: string,
): Promise<void> {
  const userVfsTurn = runtime.userVfsTurn;
  if (userVfsTurn == null) {
    return;
  }

  let trailingUser: TrailingUserSnapshot | null = null;

  // 仅 pending 非空且空续跑：末条 user 须在 flush UA 之后重挂，避免 UUA。
  if (trimmed === "" && (await userVfsTurn.hasPendingTurns(sessionId))) {
    const list = await runtime.messages.listBySession(sessionId);
    const last = list[list.length - 1];
    if (last?.role === "user") {
      trailingUser = { content: last.content, raw: last.raw };
      await runtime.messages.delete(last.id);
    }
  }

  try {
    await userVfsTurn.flushPendingUserVfsTurns(sessionId);
  } finally {
    if (trailingUser != null) {
      await runtime.messages.append(sessionId, "user", trailingUser.content, {
        raw: trailingUser.raw,
      });
    }
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
    resolveAgentForProject(runtime, scope.projectId),
  );
  stage = "resolve-model";
  const { savedModelId, workspaceModelId } = await mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition),
  );

  await options?.onAfterResolveModel?.({
    scope,
    definition,
    savedModelId,
    workspaceModelId,
    stream,
  });

  if (isUserVfsUnifiedToolTurnEnabled() && runtime.userVfsTurn != null) {
    stage = "flush-pending-user-vfs-turns";
    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      runtime,
      scope.sessionId,
      trimmed,
    );
  }

  if (trimmed !== "") {
    stage = "append-user-message";
    await runtime.messages.append(
      scope.sessionId,
      "user",
      textBlocks(trimmed),
    );
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
    async () => wt.materializePersistBlock(),
  );

  const runner = createAgentRunner(
    assembleAgentRunnerDeps({
      session,
      runtime,
      registry,
      toolCtx: {
        vfs,
        projectId: scope.projectId,
        sessionId: scope.sessionId,
        listSessionMessages: (): Promise<readonly ChatMessage[]> =>
          runtime.messages.listBySession(scope.sessionId),
      },
      includeCompactionOrchestrator: true,
    }),
  );

  try {
    stage = "runner.run";
    return await runner.run({
      definition,
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      savedModelId,
      workspaceModelId,
      maxSteps: definition.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS,
      activeRegexGroupId: activeRegexGroupId ?? undefined,
      stream,
      signal: options?.signal,
    });
  } catch (error) {
    options?.onRunFailed?.({
      stage,
      error,
      scope,
      savedModelId,
      stream,
    });
    throw error;
  }
}
