/**
 * 聊天发送编排（编排 2 步 + runner 内 2 步）。
 *
 * ## 编排（本模块）
 * 1. `prepareUserVfsTurnForAgentRun`：flush pending → `user_ops`；
 *    materialize workplace 差集（定案 A 并入 re-append merge =
 *    trailing∪flush∪attach∪materialize）；
 * 2. 外层新 append（`!reAppended`）：直 concat =
 *    materialize∪flush `user_ops`∪attach(@扫描)∪annotate → append(user, 原文, attachments)。
 *
 * ## Runner 内（agent-runner 每 step；本模块不调用 wrap/assemble）
 * 3. `assembleWorkplaceDisplay` → layout → normalize → protocol map
 * 4. `prepareUserMessagesForPrompt`（hydrate+wrap；S0）
 *
 * ## 契约
 * - App `attachments` 入参仅 `source===attach`；误传 workplace/`user_ops` 预览一律丢弃；
 *   `@` 扫描仍由 Core 合并；禁止 composer status 原样当 payload。
 * - `prompts.workplace !== true` 时 materialize 返回空（与 assemble 前缀闸门一致；user_ops /
 *   annotate / `@path` 不受影响）。
 * - `hasInput` / `shouldAppendNewUser` 在 materialize / annotateDrafts 非空时为真。
 * - 有 workplace 差集时禁止 `allowResumeWithoutInput` 纯 resume（差集=新输入）。
 * - 有 `annotateDrafts` 时本轮视 `allowResumeWithoutInput` 为 false（禁空续跑 re-append）。
 * - annotate 附件 **concat** 追加，禁止 `mergeAttachmentsByPath` / path 去重。
 * - `allowAssistantContinue`（空正文续跑）约定不 append user；即便有 workplace 差集也不因
 *   `hasWorkplaceDelta` 误 append 空 user（continue 时忽略差集对 append 的驱动）。
 * - wrap/assemble **不**在本模块写库（T-SR0）；双渲染只读。
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
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { SendAnnotateDraft } from "@/domain/chat/model/annotate-draft.schema.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import { buildAnnotateAttachmentFromDraft } from "@/domain/chat/logic/build-attachment-action-xml.js";
import { mergeAttachmentsWithScannedAtPaths } from "@/domain/chat/logic/scan-at-path-attachments.js";
import { SESSION_KKV_DOMAIN_FILE_CACHE } from "@/domain/session-kkv/model/session-kkv-domains.js";
import { ruleViewToSnapshotEntries } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { workplaceAttachmentsFromRuleDelta } from "@/domain/workplace/logic/diff-workplace-paths.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { RegexConfigService } from "@/service/regex/regex-config.port.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import type { ProjectService } from "@/service/chat/project.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
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
import { prepareUserVfsTurnForAgentRun } from "./prepare-user-vfs-turn-for-agent-run.js";
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
  readonly eventBus: SimpleEventBus;
  readonly regexConfig: RegexConfigService;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  readonly eventOrchestrator: EventOrchestrator;
  /** 用户 VFS U-A-U-A 落库；发送成功路径 flush 前置。 */
  readonly userVfsTurn?: UserVfsTurnService;
  /** write 成功后 upsert `file_cache`；须由 runtime 注入。 */
  readonly sessionKkv: SessionKkvService;
  readonly state: AgentRunRuntimePort["state"] & {
    getCurrentRegexGroupId(): Promise<string | null | undefined>;
  };
  sessionVfs(projectId: string, sessionId: string): VfsService;
  workplace(scope: VfsScope): WorkplaceService;
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
  /**
   * 空 content 续跑且末条为 user（含 App Composer 空发）。
   * 跳过「content 非空」校验；不 append user。
   * 有 workplace 差集时不得走纯 resume（差集=新输入）。
   */
  readonly allowResumeWithoutInput?: boolean;
  /**
   * CLI assistant-continue：空 content + visible 末条 assistant + maxStepsOverride: 1。
   * 跳过「末条须 user」校验；不 append user。App 不传此字段。
   */
  readonly allowAssistantContinue?: boolean;
  readonly signal?: AbortSignal;
  /** CLI `--modelId`；透传至 runner.run.cliModelId，覆盖 definition.model pin。 */
  readonly cliModelId?: string;
  /** 覆盖 definition.runtime.maxSteps；CLI continue → 1；`--max-steps` → 用户值。 */
  readonly maxStepsOverride?: number;
  /** CLI stdout 流式回调；App 经 eventBus，通常不传。 */
  readonly onStream?: (event: LlmStreamEvent) => void;
  /**
   * 仅 CLI `--agent-config` / `--agent-id` / `--prompt-path` 解析成功时注入。
   * 非空时跳过 resolveAgentForProject。
   */
  readonly definitionOverride?: AgentDefinition;
  /**
   * Composer 显式附件；**仅** `source===attach` 生效。
   * 误传的 workplace/`user_ops` 预览一律丢弃；`@` 扫描由 Core 合并。
   */
  readonly attachments?: readonly MessageAttachment[];
  /**
   * App 本轮未发送批注草稿（文件形 | 消息形联合）；Core 物化为 `action:annotate` 并 **concat** 进落库。
   * 非空时计入 hasInput / shouldAppendNewUser，且禁止空续跑 re-append。
   * Desktop 可继续只传文件形 `AnnotateDraft[]`（联合向后兼容）。
   */
  readonly annotateDrafts?: readonly SendAnnotateDraft[];
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

/**
 * 与状态条 workplace 半边同源：evaluateRuleView → ruleViewToSnapshotEntries +
 * file_cache keys → workplaceAttachmentsFromRuleDelta。
 * `layout.workplace !== true` 时短路空数组（关常驻不发规则差集）。
 */
async function materializeWorkplaceAttachments(
  runtime: AgentTurnRuntimePort,
  scope: AgentTurnScope,
  layout: Pick<AgentDefinition["prompts"], "workplace">,
): Promise<readonly MessageAttachment[]> {
  if (layout.workplace !== true) {
    return [];
  }
  const wtScope: VfsScope = {
    kind: "session",
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const view = await runtime.workplace(wtScope).evaluateRuleView();
  const live = ruleViewToSnapshotEntries(view);
  const cacheKeys = await runtime.sessionKkv.listKeys(
    scope.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
  );
  return workplaceAttachmentsFromRuleDelta(live, cacheKeys);
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
  const annotateDrafts = options?.annotateDrafts ?? [];
  const hasAnnotateDrafts = annotateDrafts.length > 0;
  // 有批注草稿时本轮禁止空续跑 re-append（prepare 不得删末条）
  const allowResumeWithoutInput =
    options?.allowResumeWithoutInput === true && !hasAnnotateDrafts;
  const allowAssistantContinue = options?.allowAssistantContinue === true;

  // 入参清洗：误传的 workplace / user_ops 预览一律丢弃，只保留 attach
  const composerAttachOnly = (options?.attachments ?? []).filter(
    (a) => a.source === "attach",
  );

  if (
    options?.allowResumeWithoutInput === true &&
    allowAssistantContinue
  ) {
    throw new AgentTurnError(
      "allowResumeWithoutInput 与 allowAssistantContinue 互斥",
    );
  }

  // 先解析 Agent：materialize 须读 prompts.workplace（与 assemble 前缀闸门一致）
  stage = "resolve-agent";
  const definition =
    options?.definitionOverride ??
    (
      await mapResolveError(() =>
        resolveAgentForProject(runtime, scope.projectId),
      )
    ).definition;

  stage = "materialize-workplace";
  const workplaceAtts = await materializeWorkplaceAttachments(
    runtime,
    scope,
    definition.prompts,
  );
  const hasWorkplaceDelta = workplaceAtts.length > 0;

  const hasPending =
    isUserVfsUnifiedToolTurnEnabled() &&
    runtime.userVfsTurn != null &&
    (await runtime.userVfsTurn.hasPendingTurns(scope.sessionId));
  const hasInput =
    trimmed !== "" ||
    composerAttachOnly.length > 0 ||
    hasPending ||
    hasWorkplaceDelta ||
    hasAnnotateDrafts;

  if (!hasInput && !allowResumeWithoutInput && !allowAssistantContinue) {
    throw new AgentTurnError("消息不能为空");
  }
  if (trimmed === "" && allowAssistantContinue) {
    if (options?.maxStepsOverride !== 1) {
      throw new AgentTurnError(
        "allowAssistantContinue 须配合 maxStepsOverride: 1",
      );
    }
  }
  // 有 workplace 差集 → 禁止纯 resume（差集=新输入）；即便误置 allowResume 也不进此支
  if (!hasInput && allowResumeWithoutInput) {
    stage = "resume-check-last-message";
    const list = await runtime.messages.listBySession(scope.sessionId);
    const last = list[list.length - 1];
    // WHY: only resume on trailing user turn to avoid consecutive assistant runs.
    if (last?.role !== "user") {
      throw new AgentTurnError("消息不能为空");
    }
  }

  stage = "resolve-model";
  const { savedModelId, workspaceModelId } = await mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition, options?.cliModelId),
  );

  await options?.onAfterResolveModel?.({
    scope,
    definition,
    savedModelId,
    workspaceModelId,
    stream,
  });

  // Scan typed @path into attach; dedupe with chips; keep tokens in body text.
  const scannedComposer = mergeAttachmentsWithScannedAtPaths(
    trimmed,
    composerAttachOnly,
  );

  let userOpsAttachments: Awaited<
    ReturnType<typeof prepareUserVfsTurnForAgentRun>
  >["attachments"] = [];
  let checkpointAnchorMessageId: string | undefined;
  let reAppended = false;

  // Flush when we can attach user_ops to a user message; assistant-continue skips pending.
  if (
    isUserVfsUnifiedToolTurnEnabled() &&
    runtime.userVfsTurn != null &&
    (hasInput || allowResumeWithoutInput) &&
    !allowAssistantContinue
  ) {
    stage = "flush-pending-user-vfs-turns";
    const prepared = await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn,
      sessionId: scope.sessionId,
      trimmedInput: trimmed,
      allowResumeWithoutInput,
      composerAttachments: scannedComposer,
      workplaceAttachments: workplaceAtts,
    });
    userOpsAttachments = prepared.attachments;
    if (prepared.reAppendedUserMessageId != null) {
      reAppended = true;
      if (prepared.flushed) {
        checkpointAnchorMessageId = prepared.reAppendedUserMessageId;
      }
      // re-append 也要通知 UI 刷新（否则空续跑写回后列表不更新）
      await options?.onUserMessageAppended?.();
    }
  }

  // annotate：concat 追加（禁止 mergeAttachmentsByPath / path 去重，以免同 path 丢条）
  const annotateAttachments = annotateDrafts.map(
    buildAnnotateAttachmentFromDraft,
  );

  // 新 append：workplace ∪ user_ops ∪ scannedComposer 直 concat；再 concat annotate（禁 path 去重）
  const mergedAttachments = [
    ...workplaceAtts,
    ...userOpsAttachments,
    ...scannedComposer,
    ...annotateAttachments,
  ];

  // allowAssistantContinue：空正文续跑约定不 append user；continue 时忽略 hasWorkplaceDelta
  const shouldAppendNewUser =
    !reAppended &&
    !allowAssistantContinue &&
    (trimmed !== "" ||
      scannedComposer.length > 0 ||
      userOpsAttachments.length > 0 ||
      hasWorkplaceDelta ||
      hasAnnotateDrafts);

  if (shouldAppendNewUser) {
    stage = "append-user-message";
    const appended = await runtime.messages.append(
      scope.sessionId,
      "user",
      textBlocks(trimmed),
      mergedAttachments.length > 0
        ? { attachments: mergedAttachments }
        : undefined,
    );
    // Checkpoint still anchors on user append that carries user_ops (P1).
    if (userOpsAttachments.length > 0) {
      checkpointAnchorMessageId = appended.id;
    }
    await options?.onUserMessageAppended?.();
  }

  if (checkpointAnchorMessageId != null) {
    stage = "capture-checkpoint-after-user-ops";
    await runtime.messageCheckpoint.capture(
      scope.sessionId,
      scope.projectId,
      checkpointAnchorMessageId,
    );
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
        sessionKkv: runtime.sessionKkv,
      },
      includeCompactionOrchestrator: true,
    }),
  );

  try {
    stage = "runner.run";
    const maxSteps =
      options?.maxStepsOverride ??
      definition.runtime?.maxSteps ??
      DEFAULT_AGENT_MAX_STEPS;
    const result = await runner.run({
      definition,
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      savedModelId,
      workspaceModelId,
      cliModelId: options?.cliModelId,
      maxSteps,
      activeRegexGroupId: activeRegexGroupId ?? undefined,
      stream,
      signal: options?.signal,
      onStream: options?.onStream,
    });
    return result;
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
