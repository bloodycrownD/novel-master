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
import { resolveSavedModelId } from "@/domain/agent/logic/resolve-saved-model-id.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import {
  registerBuiltinTools,
} from "@/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext, RunChildAgentOptions } from "@/domain/tool/builtin/builtin-tool-context.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { SendAnnotateDraft } from "@/domain/chat/model/annotate-draft.schema.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import { buildAnnotateAttachmentFromDraft } from "@/domain/chat/logic/build-attachment-action-xml.js";
import { estimateSoftRangeFromOriginalText } from "@/domain/chat/logic/annotate-source-range.js";
import { mergeAttachmentsWithScannedAtPaths } from "@/domain/chat/logic/scan-at-path-attachments.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";
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
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
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
  /**
   * 工作区 agent 注册表。父接口 {@link AgentRunRuntimePort} 已声明窄类型
   * `{ listAgentIds, get }`，这里重新声明收窄到完整 {@link AgentRegistryService}
   * （含本次新增的 `list()`）——`runChildAgent` 装配子 agent 时需要 `list()`
   * 拿可选 name、需要 `createSubSession` 建子 session（P0-3）。
   */
  readonly agentRegistry: AgentRegistryService;
  /**
   * 会话服务。父接口已声明窄类型 `{ getSessionAgentConfig }`，这里重新声明收窄到
   * 完整 {@link SessionService}（含 `createSubSession`）。
   */
  readonly sessions: SessionService;
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

  stage = "resolve-model";
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
  // 上游划词创建草稿时只传了 renderStart/renderEnd，没填 startLine/endLine，
  // 这里在落库前用 VFS 读源文本 + originalText 反查，补上精确行号（padding=0）
  // 给模型读附件时多一个「第 N 行」的位置提示；匹配不到或读盘失败就静默跳过。
  const annotateVfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  const annotateAttachments = await Promise.all(
    annotateDrafts.map(async (draft) => {
      if (draft.startLine != null && draft.endLine != null) {
        return buildAnnotateAttachmentFromDraft(draft);
      }
      let sourceText: string | undefined;
      try {
        sourceText = (await annotateVfs.read(draft.path)).content;
      } catch {
        // 文件不存在 / 权限 / 伪 path 等：拿不到源文本就跳过行号补算
      }
      if (typeof sourceText !== "string" || sourceText.length === 0) {
        return buildAnnotateAttachmentFromDraft(draft);
      }
      const softRange = estimateSoftRangeFromOriginalText(
        sourceText,
        draft.originalText,
        { linePadding: 0 },
      );
      if (softRange == null) {
        return buildAnnotateAttachmentFromDraft(draft);
      }
      // draft 来自 annotateDrafts（SendAnnotateDraft），合并行号后还是同型；显式标注避免依赖推导
      const enriched: SendAnnotateDraft = {
        ...draft,
        startLine: softRange.startLine,
        endLine: softRange.endLine,
        ...(softRange.startCol != null ? { startCol: softRange.startCol } : {}),
        ...(softRange.endCol != null ? { endCol: softRange.endCol } : {}),
      };
      return buildAnnotateAttachmentFromDraft(enriched);
    }),
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

  // 预算候选子代理名单：mode !== "primary"（排除主 agent）、排除当前 agent 自身防自递归。
  // 内置 general 永远 mode:"subagent"，排除自身后至少含 general，task 描述始终有内容。
  // task 是静态内置工具，registerBuiltinTools 已注册（probe 也含 task）；
  // 这里不单独注册 task，只把 callable 塞进下方 toolCtx.subagent.callableAgents 供 description lambda 读。
  const allDefs = await runtime.agentRegistry.list();
  const callable = allDefs
    .filter((d) => d.mode !== "primary" && d.name !== definition.name)
    .map((d) => ({ name: d.name, description: d.description }));

  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // depth=0（主 agent）：task 可用（如有 subagentCallable=true 的子代理）。
  const registry = resolveAgentToolRegistry(toolProbe, definition, { depth: 0 });
  const session = new ChatAgentSession(runtime.messages, scope.sessionId);
  const activeRegexGroupId = await runtime.state.getCurrentRegexGroupId();
  // 主 agent run 的 signal：作为 task 工具内子 agent run 的 parentSignal。
  const parentSignal = options?.signal ?? new AbortController().signal;
  const toolCtx: BuiltinToolContext = {
    vfs,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
    listSessionMessages: (): Promise<readonly ChatMessage[]> =>
      runtime.messages.listBySession(scope.sessionId),
    sessionKkv: runtime.sessionKkv,
    // task 工具读取：depth=0，捕获主 agent run 的 savedModelId/workspaceModelId/signal。
    subagent: {
      agentRegistry: runtime.agentRegistry,
      messages: runtime.messages,
      sessions: runtime.sessions,
      createChildSession: async (title: string): Promise<string> => {
 const child = await runtime.sessions.createSubSession(
          scope.sessionId,
          scope.projectId,
          title,
        );
        return child.id;
      },
      resolveChildModelId: (
        def: AgentDefinition,
      ): { savedModelId: string; workspaceModelId: string } => {
        // 子 agent pin → 父 savedModelId → 报错（不走 workspace fallback）。
        const resolved = resolveSavedModelId({
          agentModelId: def.model,
          sessionModelId: savedModelId,
        });
        if (resolved == null || resolved === "") {
          throw new AgentRunResolveError(
            "子代理未指定模型，且父 agent 也无可用 savedModelId。",
          );
        }
        return { savedModelId: resolved, workspaceModelId };
      },
      runChildAgent: async (
        def: AgentDefinition,
        childSessionId: string,
        opts: RunChildAgentOptions,
      ): Promise<AgentRunResult> => {
        return runChildAgent({
          runtime,
          parentProjectId: scope.projectId,
          parentSessionId: scope.sessionId,
          parentDepth: 0,
          def,
          childSessionId,
          opts,
        });
      },
      depth: 0,
      parentSignal,
      callableAgents: callable,
    },
  };
  const runner = createAgentRunner(
    assembleAgentRunnerDeps({
      session,
      runtime,
      registry,
      toolCtx,
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

/**
 * `runChildAgent` 内部装配：递归派生子 agent runner（P0-2 / P0-3 / P0-4 / P1-6）。
 *
 * 不抛 "暂未实现" ——本函数是 `task` 工具 `runChildAgent` 闭包背后的真正实现：
 * - VFS（P0-4）：子 agent `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)`
 *   复用父 session VFS 视图（查大纲设定场景需要能读到文件）。
 * - abort 派生（P1-6）：`new AbortController()` + `parentSignal.addEventListener("abort", ..., { once: true })`。
 * - registry（P1-10）：`resolveAgentToolRegistry(baseRegistry, def, { depth: parentDepth + 1 })`；
 *   孙 agent（depth >= 2）强制 deny task。
 * - 装配期 vs run 期（P0-2）：`assembleAgentRunnerDeps({ ..., includeCompactionOrchestrator: false })`
 *   是装配期字段，不在 `AgentRunOptions`。
 */
async function runChildAgent(args: {
  readonly runtime: AgentTurnRuntimePort;
  readonly parentProjectId: string;
  readonly parentSessionId: string;
  readonly parentDepth: number;
  readonly def: AgentDefinition;
  readonly childSessionId: string;
  readonly opts: RunChildAgentOptions;
}): Promise<AgentRunResult> {
  const {
    runtime,
    parentProjectId,
    parentSessionId,
    parentDepth,
    def,
    childSessionId,
    opts,
  } = args;
  const childDepth = parentDepth + 1;

  // 装配子 agent 用的 registry：vfs 6 件 + 静态 task（孙 agent 被 resolve deny）。
  const baseRegistry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(baseRegistry);
  // 预算候选子代理名单：mode !== "primary"、排除子 agent 自身。
  // task 是否对 LLM 可见由下方 resolveAgentToolRegistry 的 depth 判断控制（depth>=2 deny）。
  const childAllDefs = await runtime.agentRegistry.list();
  const callable = childAllDefs
    .filter((d) => d.mode !== "primary" && d.name !== def.name)
    .map((d) => ({ name: d.name, description: d.description }));
  const registry = resolveAgentToolRegistry(baseRegistry, def, {
    depth: childDepth,
  });

  // VFS（P0-4）：子 agent 用父 session 的 VFS 视图（能读到父会话文件）。
  const vfs = runtime.sessionVfs(parentProjectId, parentSessionId);

  // abort 派生（P1-6）：子 agent 退出/完成不应反向影响父 signal。
  const childController = new AbortController();
  const parentSignal = opts.signal;
  if (parentSignal.aborted) {
    childController.abort();
  } else {
    parentSignal.addEventListener(
      "abort",
      () => {
        childController.abort();
      },
      { once: true },
    );
  }

  const session = new ChatAgentSession(runtime.messages, childSessionId);

  // task 工具的 prompt 作为子 session 的第一条 user 消息落库，
  // 使子 agent 对话历史完整：LLM 能看到任务描述，UI 浏览页也能展示。
  if (opts.prompt && opts.prompt.trim().length > 0) {
    await session.append("user", textBlocks(opts.prompt));
  }
  const activeRegexGroupId = await runtime.state.getCurrentRegexGroupId();
  const toolCtx: BuiltinToolContext = {
    vfs,
    projectId: parentProjectId,
    sessionId: childSessionId,
    listSessionMessages: (): Promise<readonly ChatMessage[]> =>
      runtime.messages.listBySession(childSessionId),
    sessionKkv: runtime.sessionKkv,
    // 子 agent 也有 subagent 闭包：递归 depth=childDepth，孙 agent 装配的 registry 已 deny task。
    subagent: {
      agentRegistry: runtime.agentRegistry,
      messages: runtime.messages,
      sessions: runtime.sessions,
      createChildSession: async (title: string): Promise<string> => {
        const grandchild = await runtime.sessions.createSubSession(
          childSessionId,
          parentProjectId,
          title,
        );
        return grandchild.id;
      },
      resolveChildModelId: (
        grandchildDef: AgentDefinition,
      ): { savedModelId: string; workspaceModelId: string } => {
        // 子 agent pin → 父子 agent 的 savedModelId → 报错（不走 workspace fallback）。
        const resolved = resolveSavedModelId({
          agentModelId: grandchildDef.model,
          sessionModelId: opts.savedModelId,
        });
        if (resolved == null || resolved === "") {
          throw new AgentRunResolveError(
            "孙代理未指定模型，且子 agent 也无可用 savedModelId。",
          );
        }
        return {
          savedModelId: resolved,
          workspaceModelId: opts.workspaceModelId,
        };
      },
      runChildAgent: async (
        grandchildDef: AgentDefinition,
        grandchildSessionId: string,
        grandchildOpts: RunChildAgentOptions,
      ): Promise<AgentRunResult> => {
        return runChildAgent({
          runtime,
          parentProjectId,
          parentSessionId: childSessionId,
          parentDepth: childDepth,
          def: grandchildDef,
          childSessionId: grandchildSessionId,
          opts: grandchildOpts,
        });
      },
      depth: childDepth,
      parentSignal: childController.signal,
      callableAgents: callable,
    },
  };

  const runner = createAgentRunner(
    assembleAgentRunnerDeps({
      session,
      runtime,
      registry,
      toolCtx,
      // 装配期 false：子 agent run 不走压缩编排（P0-2）。
      includeCompactionOrchestrator: false,
    }),
  );

  const maxSteps = opts.maxSteps ?? def.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS;
  return runner.run({
    definition: def,
    sessionId: childSessionId,
    projectId: parentProjectId,
    savedModelId: opts.savedModelId,
    workspaceModelId: opts.workspaceModelId,
    maxSteps,
    activeRegexGroupId: activeRegexGroupId ?? undefined,
    // run 期：persistMessages=true 落库供 UI 浏览；publishRunLifecycle=false 不发总线事件；stream=false。
    persistMessages: true,
    publishRunLifecycle: false,
    stream: false,
    signal: childController.signal,
  });
}
