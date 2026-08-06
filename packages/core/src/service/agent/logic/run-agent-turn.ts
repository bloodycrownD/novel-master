/**
 * 聊天发送编排（编排 2 步 + runner 内 2 步）。
 *
 * ## 编排（本模块）
 * 1. `prepareUserVfsTurnForAgentRun`：flush pending → `user_ops`；
 *    re-append merge = trailing∪flush∪attach（无 workplace materialize）。
 * 2. 外层新 append（`!reAppended`）：直 concat =
 *    flush `user_ops`∪attach(@扫描)∪annotate → append(user, 原文, attachments)。
 *
 * ## Runner 内（agent-runner 每 step；本模块不调用 wrap/assemble）
 * 3. `assembleWorkplaceDisplay` → layout → normalize → protocol map
 * 4. `prepareUserMessagesForPrompt`（hydrate+wrap；S0）
 *
 * ## 契约
 * - App `attachments` 入参仅 `source===attach` 生效；误传的 `user_ops` 预览一律丢弃；
 *   `@` 扫描仍由 Core 合并；禁止 composer status 原样当 payload。
 * - workplace 不再走附件通道：规则变更靠 `refreshRuleSnapshot` + 常驻前缀 S0 注入。
 * - `hasInput` / `shouldAppendNewUser`：正文 / attach / pending / annotateDrafts。
 * - 有 `annotateDrafts` 时本轮视 `allowResumeWithoutInput` 为 false（禁空续跑 re-append）。
 * - annotate 附件 **concat** 追加，禁止 `mergeAttachmentsByPath` / path 去重。
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
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import { CoordinatedWrite } from "@/service/coordinated-write.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
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
  readonly providerRepo?: Pick<ProviderRepository, "findById">;
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
   * workplace 已不再走附件通道，故无 workplace 差集概念；该能力仅为三端共用的空续跑兼容。
   *
   * 三端共用（mobile/desktop/CLI）的空续跑能力，保留不动。
   */
  readonly allowResumeWithoutInput?: boolean;
  readonly signal?: AbortSignal;
  /** CLI stdout 流式回调；App 经 eventBus，通常不传。 */
  readonly onStream?: (event: LlmStreamEvent) => void;
  /**
   * Composer 显式附件；**仅** `source===attach` 生效。
   * 误传的 `user_ops` 预览一律丢弃（filter 保留拦截）；`@` 扫描由 Core 合并。
   * workplace 为历史只读兼容，新数据不再产生。
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

  // 入参清洗：误传的 user_ops 预览一律丢弃，只保留 attach（workplace 为历史只读兼容，新数据不再产生）
  const composerAttachOnly = (options?.attachments ?? []).filter(
    (a) => a.source === "attach",
  );

  // S-13 扩展：每轮发送开头都尝试 backfill 一下历史空窗消息。Step 9 之后新消息
  // 在源头就有 baseline 了，但旧会话里可能还留着没有 checkpoint 的历史消息——
  // 这里幂等地补齐，确保 undo_send 始终能找到可回滚点。已有 checkpoint 的消息不动。
  stage = "backfill-baseline-checkpoints";
  await runtime.messageCheckpoint.backfillMissingBaselines(
    scope.sessionId,
    scope.projectId,
  );

  stage = "resolve-agent";
  const definition = (
    await mapResolveError(() =>
      resolveAgentForProject(runtime, scope.projectId, scope.sessionId),
    )
  ).definition;

  const hasPending =
    isUserVfsUnifiedToolTurnEnabled() &&
    runtime.userVfsTurn != null &&
    (await runtime.userVfsTurn.hasPendingTurns(scope.sessionId));
  const hasInput =
    trimmed !== "" ||
    composerAttachOnly.length > 0 ||
    hasPending ||
    hasAnnotateDrafts;

  if (!hasInput && !allowResumeWithoutInput) {
    throw new AgentTurnError("消息不能为空");
  }
  if (!hasInput && allowResumeWithoutInput) {
    stage = "resume-check-last-message";
    const list = await runtime.messages.listBySession(scope.sessionId);
    const last = list[list.length - 1];
    // WHY: only resume on trailing user turn to avoid consecutive assistant runs.
    if (last?.role !== "user") {
      throw new AgentTurnError("消息不能为空");
    }
  }

  stage = "resolve-agent";
  const { savedModelId, workspaceModelId } = await mapResolveError(() =>
    resolveApplicationModelIdForRun(runtime, definition, scope.sessionId),
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

  // Flush when we can attach user_ops to a user message.
  if (
    isUserVfsUnifiedToolTurnEnabled() &&
    runtime.userVfsTurn != null &&
    (hasInput || allowResumeWithoutInput)
  ) {
    stage = "flush-pending-user-vfs-turns";
    const prepared = await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn,
      sessionId: scope.sessionId,
      trimmedInput: trimmed,
      allowResumeWithoutInput,
      composerAttachments: scannedComposer,
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

  // 新 append：user_ops ∪ scannedComposer 直 concat；再 concat annotate（禁 path 去重）
  const mergedAttachments = [
    ...userOpsAttachments,
    ...scannedComposer,
    ...annotateAttachments,
  ];

  const shouldAppendNewUser =
    !reAppended &&
    (trimmed !== "" ||
      scannedComposer.length > 0 ||
      userOpsAttachments.length > 0 ||
      hasAnnotateDrafts);

  // S-1：append + capture 这条跨资源写链走 CoordinatedWrite，任一步失败按逆序补偿。
  // append 的补偿是删掉刚写入的消息；capture 的补偿是 release 刚写的 checkpoint。
  // reAppended 路径下消息已被 prepareUserVfsTurnForAgentRun 写回，这里只注册 capture。
  const coordinatedWrite = new CoordinatedWrite();
  if (shouldAppendNewUser) {
    stage = "append-user-message";
    coordinatedWrite.register({
      name: "append-user-message",
      execute: async () => {
        const appended = await runtime.messages.append(
          scope.sessionId,
          "user",
          textBlocks(trimmed),
          mergedAttachments.length > 0
            ? { attachments: mergedAttachments }
            : undefined,
        );
        // S-13 治本：每条新 user 消息都写 baseline checkpoint，确保后续步骤失败时
        // undo_send 仍有可回滚点。原先仅在 userOpsAttachments 非空时才 capture，
        // 导致普通纯文本 chat 路径无 baseline，undo_send 时 targetTree 空 → 删光工作区。
        // 这里把不变式上提到源头，user_ops 路径的 anchor 语义保留（仍走同一 capture）。
        checkpointAnchorMessageId = appended.id;
        // re-append 也要通知 UI 刷新（否则空续跑写回后列表不更新）
        await options?.onUserMessageAppended?.();
      },
      rollback: async () => {
        const appendedId = checkpointAnchorMessageId;
        if (appendedId != null) {
          await runtime.messages.delete(appendedId);
        }
      },
    });
  }

  // capture 步骤：anchor 可能来自上面的 append execute，也可能来自 reAppended 路径。
  // 放进 execute 内取值，保证 append 成功后才读到正确的 anchor。
  coordinatedWrite.register({
    name: "capture-baseline-checkpoint",
    execute: async () => {
      const anchorId = checkpointAnchorMessageId;
      if (anchorId == null) return;
      stage = "capture-baseline-checkpoint";
      await runtime.messageCheckpoint.capture(
        scope.sessionId,
        scope.projectId,
        anchorId,
      );
    },
    rollback: async () => {
      const anchorId = checkpointAnchorMessageId;
      if (anchorId != null) {
        // release 可选：runtime 未提供时按 best-effort no-op 处理。
        await runtime.messageCheckpoint.release?.(scope.sessionId, anchorId);
      }
    },
  });

  await coordinatedWrite.run();

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
        // A-14 path policy：三端共用走 runAgentTurn，这里统一不限制（undefined）；
        // 后续若要按 platform / project 收紧，改成 resolveAllowedPaths(...) 即可。
        allowedPaths: undefined,
        resourceQuota: undefined,
      },
      includeCompactionOrchestrator: true,
    }),
  );

  try {
    stage = "runner.run";
    const maxSteps =
      definition.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS;
    const result = await runner.run({
      definition,
      sessionId: scope.sessionId,
      projectId: scope.projectId,
      savedModelId,
      workspaceModelId,
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
