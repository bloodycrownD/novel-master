/**
 * 聊天发送编排（编排 1 步 + runner 内 2 步）。
 *
 * ## 编排（本模块）
 * 1. 外层新 append：直 concat = attach(@扫描)∪annotate → append(user, 原文, attachments)。
 *
 * ## Runner 内（agent-runner 每 step；本模块不调用 wrap/assemble）
 * 2. `assembleWorkplaceDisplay` → layout → normalize → protocol map
 * 3. `prepareUserMessagesForPrompt`（hydrate+wrap；S0）
 *
 * ## 契约
 * - App `attachments` 入参仅 `source===attach` 生效；误传的 `user_ops` 预览一律丢弃；
 *   `@` 扫描仍由 Core 合并；禁止 composer status 原样当 payload。
 * - workplace 不再走附件通道：规则变更靠 `refreshRuleSnapshot` + 常驻前缀 S0 注入。
 * - `hasInput` / `shouldAppendNewUser`：正文 / attach / annotateDrafts。
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
import { registerBuiltinTools } from "@/domain/tool/builtin/register-builtin-tools.js";
import type {
  BuiltinToolContext,
  RunChildAgentOptions,
} from "@/domain/tool/builtin/builtin-tool-context.js";
import type {
  BuiltinToolAgentsContext,
  BuiltinToolSearchContext,
  BuiltinToolSkillsContext,
} from "@/domain/tool/builtin/builtin-tool-context.js";
import { SKILL_TOOL_NAME } from "@/domain/tool/builtin/skill-tool.js";
import { AGENT_TOOL_NAME } from "@/domain/tool/builtin/agent-tool.js";
import type { SearchConfigStore } from "@/domain/tool/builtin/search/search-config.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import { PreferencesError } from "@/errors/preferences-errors.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
} from "@/domain/events/model/event-types.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { SendAnnotateDraft } from "@/domain/chat/model/annotate-draft.schema.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";
import { buildAnnotateAttachmentFromDraft } from "@/domain/chat/logic/build-attachment-action-xml.js";
import { estimateSoftRangeFromOriginalText } from "@/domain/chat/logic/annotate-source-range.js";
import { mergeAttachmentsWithScannedAtPaths } from "@/domain/chat/logic/scan-at-path-attachments.js";
import { mergeAttachmentsWithScannedSkills } from "@/domain/chat/logic/scan-skill-attachments.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import { CoordinatedWrite } from "@/service/coordinated-write.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "@/service/chat/message-transcript-effects.port.js";
import type { SessionService } from "@/service/chat/session.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { VfsService } from "@/service/vfs/vfs.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import type { ProjectService } from "@/service/chat/project.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { AgentAbortRegistry } from "@/service/agent/agent-abort-registry.port.js";
import type { AgentStreamRegistry } from "@/service/agent/agent-stream-registry.port.js";
import type { AgentStreamRegistryHandle } from "@/service/agent/agent-stream-registry.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import type { PersistentPreferences } from "@/service/persistent-preferences/persistent-preferences.port.js";
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
  /**
   * Agent abort registry：按 sessionId 索引 in-flight run 的 controller，
   * 给 mobile / desktop 停止按钮一个统一中断入口。
   *
   * CLI 不注入也能跑（`abortRegistry?.register(...)` 空安全）。
   */
  readonly abortRegistry?: AgentAbortRegistry;
  /**
   * Agent stream registry：按 sessionId 索引 in-flight run 的流式累积文本，
   * 供子会话页首次进入时查询已生成的 partial（eventBus 无 replay）。
   *
   * CLI 不注入也能跑（`streamRegistry?.register(...)` 空安全）。
   */
  readonly streamRegistry?: AgentStreamRegistry;
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
  /** hide/show/truncate 消息 transcript（runCompaction 执行压缩时使用）。 */
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
  readonly messageCheckpoint: MessageCheckpointService;
  readonly modelRequests: ModelRequestService;
  readonly savedModelRepo: SavedModelRepository;
  readonly providerRepo?: Pick<ProviderRepository, "findById">;
  readonly eventBus: SimpleEventBus;
  readonly compactionConditionEvaluator: CompactionConditionEvaluator;
  /** 用户 VFS 写入端口：executeOp 由 VFS 写链路直接消费，本模块不再使用该成员。 */
  readonly userVfsTurn?: UserVfsTurnService;
  /** write 成功后 upsert `file_cache`；须由 runtime 注入。 */
  readonly sessionKkv: SessionKkvService;
  readonly state: AgentRunRuntimePort["state"];
  sessionVfs(projectId: string, sessionId: string): VfsService;
  workplace(scope: VfsScope): WorkplaceService;
  /**
   * 技能服务惰性工厂（skill 工具用）。三端 runtime 均已暴露；
   * 声明为可选是为了不强制旧测试 mock 补字段——未注入时 skill
   * 的 run 抛 ToolError，且 description 预算跳过（不产生 IO）。
   */
  readonly skills?: () => SkillService;
  /**
   * 偏好窄切片。三端 runtime 对象均已携带完整
   * `preferences: PersistentPreferences` 字段，结构化兼容无需 app 端改动；
   * 声明为可选是为了不强制旧测试 mock 补字段——thinkingContext 未注入
   * 时等同默认关，subagentStream 未注入时等同默认开。
   */
  readonly preferences?: Pick<
    PersistentPreferences,
    "getThinkingContextEnabled" | "getSubagentStreamEnabled"
  >;
  /**
   * 搜索配置存储（search 工具用）：desktop / mobile runtime 用 core 导出
   * 的 `createSearchConfigStore(kkv + secretStore)` 工厂装配。
   *
   * 可选声明照 preferences Pick 先例——不强制旧测试 mock 补字段；未注入
   * 时（CLI 无 kkv）search 工具 run 返回可读错误，恒不可用（known
   * limitation，后续迭代 CLI 接入 kkv 后补一行装配即可启用）。
   */
  readonly searchConfig?: SearchConfigStore;
}

export class AgentTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTurnError";
  }
}

/**
 * 预算并装配 `skill` 工具上下文（主 / 子两个装配点共用，D2）。
 *
 * 清单按传入 projectId 解析（子代理传父会话 projectId，与「子代理共享
 * 父工作区」语义一致）。resolve 后 registry 不含 skill（policy deny，
 * D4）时跳过 effectiveSkills 预算、返回 undefined——工具仍注册在 probe，
 * 但本 run 的 toolCtx 不带 skills 闭包，LLM 也看不到该工具。
 *
 * 注：skillsIndex（提示词技能索引）的 D4 置空联动属 Step 10，不在本函数范围。
 */
export async function assembleSkillsToolContext(
  runtime: Pick<AgentTurnRuntimePort, "skills">,
  projectId: string,
  registry: ToolRegistry<BuiltinToolContext>
): Promise<BuiltinToolSkillsContext | undefined> {
  const service = runtime.skills?.();
  if (service == null) return undefined;
  if (!registry.list().includes(SKILL_TOOL_NAME)) return undefined;
  const effective = await service.effectiveSkills(projectId);
  // referencedNames：seen 共享（方向 A）的可变集合，runner 每步 prepare 后回填
  return { service, projectId, effective, referencedNames: new Set<string>() };
}

/**
 * 装配 `search` 工具闭包（主 / 子两个装配点共用）：绑定 runtime 的
 * SearchConfigStore；引擎解析与凭证明文读取全部延迟到工具 run 内，
 * 装配期零 IO（与 skills 的装配期预算模式不同，search 的 description
 * 是静态文案）。
 */
export function assembleSearchToolContext(
  store: SearchConfigStore
): BuiltinToolSearchContext {
  return {
    resolveEngineChain: (inputEngine) =>
      store.resolveEngineChain(inputEngine),
  };
}

/**
 * 预算并装配 `agent` 管理工具上下文（主 / 子两个装配点共用，B2）。
 *
 * 数据零新增 IO：`agents` 快照复用装配点已取的 `agentRegistry.list()`
 * 全量定义（主装配点 allDefs / runChildAgent 的 childAllDefs），映射为
 * { name, description, mode }（含虚拟 seed general）；`registeredToolNames`
 * 复用 probe 注册表名单，透传给工具内 upsert 的工具策略校验。resolve 后
 * registry 不含 `agent`（子/孙摘除 D6 或用户 policy deny）时返回
 * undefined——闭包不注入，工具的 run 抛 ToolError（FAILED）。
 *
 * 注：`agentRegistry.list()` 返回 Promise，而工具 description lambda 是同步
 * 求值——所以快照必须装配期预算（照 skills / task 同款模式），不能 lambda 现查。
 */
export function assembleAgentsToolContext(
  agentRegistry: AgentRegistryService,
  allDefs: readonly AgentDefinition[],
  probeNames: readonly string[],
  registry: ToolRegistry<BuiltinToolContext>
): BuiltinToolAgentsContext | undefined {
  if (!registry.list().includes(AGENT_TOOL_NAME)) return undefined;
  return {
    registry: agentRegistry,
    agents: allDefs.map((d) => ({
      name: d.name,
      ...(d.description != null ? { description: d.description } : {}),
      mode: d.mode ?? "all",
    })),
    registeredToolNames: [...probeNames],
  };
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
    ctx: RunAgentTurnAfterResolveContext
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
 *
 * **abort 注册前移（2026-09-30 实锤，用户报「发送期间无法终止」）**：controller
 * 原先直到 runner 起步前才注册，中间隔着 backfill / resolve / append / capture /
 * 技能预算等**整段前奏**（大会话上是秒级）——期间 `abortRegistry.abort(sessionId)`
 * 找不到 controller，`stopRun` 返回 false 把停止意图**整个丢掉**（不是延迟，是丢），
 * 用户体感就是「点了停止没反应，然后它照旧开始生成」。现在从函数入口就注册：
 * run 被受理即视为在途（与 mobile 发送门禁 / 校准探针的「在途」口径一致），
 * 前奏期间的停止照样命中 controller。兑现不再只靠 runner 起步后的第一个检查点
 * （`loop_start`）——前奏内部在 append+capture 之后与 runner.run 之前各有一道
 * 检查点（见 `preludeAbortResult`），命中即跳过剩余前奏、以合成 cancelled 结果
 * 收尾（runner 未起步，不发 RUN_STARTED/RUN_FINISHED；用户消息已在 append 阶段
 * 落库，保留；undo_send 可回收）。
 *
 * 反注册仍由内层 finally 完成（保持原顺序）；这里再挂一道**幂等**兜底，
 * 覆盖「前奏抛错、内层 try 尚未进入」的路径——否则陈旧 controller 会让
 * `abortRegistry.has` 永久为真，卡死该会话后续的发送门禁。
 */
export async function runAgentTurn(
  runtime: AgentTurnRuntimePort,
  scope: AgentTurnScope,
  userContent: string,
  options?: RunAgentTurnOptions
): Promise<AgentRunResult> {
  // 主 run 始终自建 internalController 作为注册目标——不管 caller 有没有传 signal。
  // caller signal（如果有）桥接到 internal：外部 abort 级联到 internal。
  // runner.run 拿 internal.signal；同时 internal.signal 作为 task 工具内子 agent run
  // 的 parentSignal，让 registry.abort(sessionId) 也能级联到子 run。
  const internalController = new AbortController();
  const callerSignal = options?.signal;
  if (callerSignal != null) {
    if (callerSignal.aborted) {
      internalController.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener(
        "abort",
        () => internalController.abort(callerSignal.reason),
        { once: true }
      );
    }
  }
  runtime.abortRegistry?.register(scope.sessionId, internalController);
  try {
    return await runAgentTurnWithController(
      runtime,
      scope,
      userContent,
      options,
      internalController
    );
  } finally {
    // unregister 带所有权比对：内层已反注册时为 no-op（幂等兜底）。
    runtime.abortRegistry?.unregister(scope.sessionId, internalController);
  }
}

/**
 * 发终态事件的唯一出口。
 *
 * 为什么包 try/catch：事件是 fire-and-forget 的**收口通知**，绝不能反过来把
 * 「前奏抛出的原始错误」或「检查点命中的正常取消」顶掉——publish 抛错会一路
 * 冒到调用方，把真实病因换成 `publish is not a function` 之类（CLI / 老 mock
 * 里 runtime.eventBus 是占位对象，publish 并不存在）。
 * SimpleEventBus 自己也会吞掉 handler 抛错，这层再兜一次 bus 本身的问题。
 */
function safePublish(
  runtime: AgentTurnRuntimePort,
  type: string,
  payload: Record<string, unknown>,
): void {
  try {
    runtime.eventBus?.publish(type, payload);
  } catch (err) {
    console.error("[run-agent-turn] prelude_terminal_publish_failed", {
      type,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 「检查点命中」的合成 cancelled 结果（主 run 的 ⓪/①/② 与子 run 的两道共用）。
 *
 * 与 runner 内部 `loop_start` 取消路径同款形状：stepsExecuted=0、无 rounds。
 * 每次调用都新建对象——结果会被调用方与 task 工具回流逻辑读，共享实例没有
 * 好处却多一处可变状态。
 */
function syntheticCancelledResult(): AgentRunResult {
  return { stepsExecuted: 0, finished: false, stopReason: "cancelled", rounds: [] };
}

/**
 * 前奏期「检查点命中」的唯一终态出口：发 `EVENT_AGENT_RUN_FINISHED` 后调用方
 * 返回合成 cancelled 结果。
 *
 * payload 硬约束（r3-run-1 步骤 1，改动前先读这段注释）：
 * - `runId: ''`——runner 从未起步，没有真实 runId。前奏终态与真实终态在下游
 *   靠这个「空串」区分（mobile manager 已有 `runId === ''` 放行分支）。
 * - `vfsMutated: false`——**硬约束**。desktop `ShellNavProvider.tsx:341` 按
 *   `vfsMutated !== true` 早退，填 true 会误刷整棵工作区树；前奏期也确实没跑过
 *   任何 tool 轮。
 * - sessionId/projectId 取本次 run 的 scope（子 run 走 r3-run-3 的同款出口，
 *   传 childSessionId / parentProjectId）。
 *
 * 不变式：`runAgentTurn` 返回 cancelled ⇒ 恰好一条 FINISHED('')。
 */
function publishPreludeRunFinished(
  runtime: AgentTurnRuntimePort,
  scope: AgentTurnScope
): void {
  safePublish(runtime, EVENT_AGENT_RUN_FINISHED, {
    sessionId: scope.sessionId,
    projectId: scope.projectId,
    runId: "",
    stopReason: "cancelled",
    vfsMutated: false,
  });
}

/**
 * 订阅事件的空安全版（配套 {@link safePublish}）。
 *
 * 用途只有终态观测窗——它是**观测**，不是收口：装不上顶多让 catch 误以为
 * 「没发过终态」而多补一条 FAILED(runId:'')，绝不该反过来把 run 带崩。
 */
function subscribeQuietly(
  runtime: AgentTurnRuntimePort,
  type: string,
  handler: (payload: unknown) => void
): { unsubscribe: () => void } {
  try {
    const sub = runtime.eventBus?.subscribe(type, handler);
    if (sub == null) {
      return { unsubscribe: () => {} };
    }
    // 老 mock 的 subscribe 返回裸退订函数，按 SimpleEventBus 契约取 unsubscribe。
    const unsubscribe =
      typeof sub === "function" ? (sub as () => void) : sub.unsubscribe;
    return {
      unsubscribe: () => {
        try {
          unsubscribe.call(sub);
        } catch {
          // 退订失败无可挽回，也不值得为它抛——run 已经在收尾了
        }
      },
    };
  } catch {
    return { unsubscribe: () => {} };
  }
}

/**
 * 前奏期「抛错」的唯一终态出口：发 `EVENT_AGENT_RUN_FAILED`（`runId: ''`），
 * 由调用方 rethrow 保留原错误对象。
 *
 * 为什么必须发：前奏段在 runner 起步前抛错时，desktop/mobile 两侧都只看到
 * 一个 reject——main 侧 refcount 无人收敛、renderer 侧 uiRunning 永久 true
 * （停止按钮卡死、composer 锁住）。发事件后两侧走与真实 FAILED 完全相同的
 * 收口链路。
 *
 * 防双发（r3-run-1 步骤 2b）：`agent-runner.ts` 的主 try catch 已经发过一条
 * **真实 runId** 的 FAILED，那条路径绝不经过本函数——由调用点的
 * `runnerEmittedTerminal` 判据守卫（见 `runAgentTurnWithController`）。
 */
function publishPreludeRunFailed(
  runtime: AgentTurnRuntimePort,
  scope: AgentTurnScope,
  error: unknown
): void {
  safePublish(runtime, EVENT_AGENT_RUN_FAILED, {
    sessionId: scope.sessionId,
    projectId: scope.projectId,
    runId: "",
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * {@link runAgentTurn} 的实现体：controller 由入口建好并注册后传入。
 */
async function runAgentTurnWithController(
  runtime: AgentTurnRuntimePort,
  scope: AgentTurnScope,
  userContent: string,
  options: RunAgentTurnOptions | undefined,
  internalController: AbortController
): Promise<AgentRunResult> {
  let stage = "start";
  /**
   * runner 是否已起步（`await runner.run(...)` 紧前置真）。
   *
   * 用途：区分「前奏期失败」与「runner 期失败」——只有后者才调
   * {@link RunAgentTurnOptions.onRunFailed}（它的语义是 runner 期失败的前奏
   * 快照）。**不**用于判断要不要补发 FAILED，见下面的 `runnerEmittedTerminal`。
   *
   * 声明在收口 try **之外**——catch 与 finally 都要读它。
   */
  let runnerEntered = false;
  /**
   * 本次 run 期间 core 是否已发过**真实 runId** 的终态事件（FINISHED/FAILED）。
   *
   * 这是 catch 里「要不要补发 FAILED(runId:'')」的**唯一**判据，比 spec 的
   * `!runnerEntered` 守卫更强一档：r3-run-2 把 STARTED 下移到 agent-runner 主 try
   * 紧前后，`runnerEntered=true` 与「STARTED 真的发出去了」之间还夹着一小段
   * runner 自身的前置 IO（`savedModels.findById` / preferences 读）。那段抛错时
   * STARTED 与 FAILED 都还没发，若只看 `runnerEntered` 就会一个终态都不发
   * ——正是 r3-run-2 要消灭的 refcount 永久泄漏换个位置复发。
   *
   * 判据用「有没有发过」而不是「有没有发 STARTED」：STARTED 与终态在
   * agent-runner 内部是同生共死的（主 try 的 catch 必发 FAILED），而
   * FINISHED 分支后半段（token 缓存落库）若抛错也属于「已发过 FINISHED，
   * 不该再补 FAILED」。
   *
   * 订阅只在本 run 的 runner 调用窗口内存在，且按 sessionId 过滤（子 run 的
   * 终态带 childSessionId，不会误判为父 run 的）；事件总线同步分发，读到的
   * 永远是本 run 窗口内的事实。
   */
  let runnerEmittedTerminal = false;
  /**
   * 生成 bus 回调：命中本 session 的终态事件就把 `runnerEmittedTerminal` 置真。
   *
   * 按 sessionId 过滤是必要的——同一个 bus 上还跑着 task 工具派生的子 run，
   * 它们的终态带 childSessionId，不能算作本 run 已经有终态。
   */
  const markRunnerTerminal =
    (): ((payload: unknown) => void) =>
    (payload: unknown) => {
      if ((payload as { sessionId?: string } | null)?.sessionId === scope.sessionId) {
        runnerEmittedTerminal = true;
      }
    };
  /**
   * streamRegistry 所有权句柄：prelude 内 register、finally 回传。
   * 声明在收口 try 之外（register 在 try 内、unregister 在 try 外）。
   */
  let streamHandle: AgentStreamRegistryHandle | undefined;
  /**
   * 已解析的 savedModelId 镜像（供 catch 的 onRunFailed 入参，见 resolve 处的注释）。
   */
  let failureSavedModelId: string | undefined;
  const stream = options?.stream !== false;
  const trimmed = userContent.trim();
  const annotateDrafts = options?.annotateDrafts ?? [];
  const hasAnnotateDrafts = annotateDrafts.length > 0;
  // 有批注草稿时本轮禁止空续跑 re-append（prepare 不得删末条）
  const allowResumeWithoutInput =
    options?.allowResumeWithoutInput === true && !hasAnnotateDrafts;

  // 入参清洗：误传的 user_ops 预览一律丢弃，只保留 attach（workplace 为历史只读兼容，新数据不再产生）
  const composerAttachOnly = (options?.attachments ?? []).filter(
    (a) => a.source === "attach"
  );

  // 前奏停止检查点（2026-09-30 真机实锤，用户连点 15 次停止需等 11s 前奏跑完
  // 才在 loop_start 兑现）：前奏各阶段之间检查 signal，命中即跳过剩余前奏、
  // 返回合成 cancelled 结果。合成结果与 runner loop_start 取消路径同款；runner
  // 从未起步，故不发 RUN_STARTED，但**发一条 FINISHED(runId:'') 收口**
  // （r3-run-1：此前不补这条，desktop 前奏取消会让 refcount 永久泄漏、
  // 转录冻结永久挂起；mobile 靠 .then 手工补丁——双端都在事件系统之外打补丁，
  // 现在统一收敛到事件路线）。
  //
  // 检查点分布（r3-run-3/run-4 补全覆盖）：
  //   ⓪ backfill 之前 —— 这次发送**根本没发生**（用户消息未落库），见下；
  //   ① append+capture 之后 —— 消息已落库，停止不改变「本次发送已发生」；
  //   ② agentRegistry.list() 之后 / skills 装配之后 / runner.run 之前。
  const preludeAbortResult = (): AgentRunResult | undefined =>
    internalController.signal.aborted ? syntheticCancelledResult() : undefined;

  // 收口 try（r3-run-1 步骤 2）：从 backfill 到 `runner.run` 全程包起来。
  //
  // 为什么必须包：这段前半（前奏）在改动前**没有**任何 try，是真实抛错出口。
  // 抛错时双端只看到 reject——desktop main 的 refcount 无人收敛（后续全部
  // AGENT_BUSY）、renderer 的 uiRunning 永久 true（停止按钮卡死、composer
  // 锁住）。补一条 FAILED(runId:'') 后，双端走与真实 FAILED 完全相同的收口
  // 链路，再原样 rethrow 保留错误对象。
  //
  // 为什么是「一个 try」而不是「前奏 try + 主 try」两段：两段各自的 catch 会
  // 重复同一段 publish 逻辑，双发风险反而更高（两处都要写 runnerEntered 守卫，
  // 漏一处就双发）。合到一个 catch 后，`!runnerEntered` 成为**唯一**的补发
  // 判据——不变式「抛错 ⇒ 恰好一条 FAILED」在结构上就只剩一个出口。
  // 行为与 spec 的两段式等价：前奏抛错不发 onRunFailed、runner 期抛错发
  // onRunFailed 且不补发 FAILED('')。子 run 侧（runChildAgent）的同款包装
  // 由 r3-run-3 落。
  try {
    // 检查点⓪（r3-run-4）：backfill **之前**的第一道。
    //
    // 命中它意味着「这次发送根本没发生」——用户消息尚未 append、没有
    // checkpoint、没有任何落库痕迹。这与 ①② 的语义差一档：①② 停在一段已经
    // 追加了用户消息的链上，停止不改变「本次发送已发生」的事实（undo_send 可
    // 回收）；⓪ 命中时连消息都没有，所以面板上什么都不该出现。
    //
    // 与 r3-run-1 的联动（重要，勿改）：⓪ 命中同样要发 FINISHED(runId:'')
    // 收口——双端（desktop refcount / composer 解锁、mobile 单元 settle）拿到的
    // 是同一个「run 已结束」事实。settle 之后 desktop 走 reloadMessages，**它会
    // 拿回旧的消息列表，这是正确行为而不是 bug**：⓪ 的定义就是「没发送过」，
    // 库里本来就没有本轮消息，reload 自然看不到新的。①② 之所以需要
    // 「runId==='' 强制 reload」是因为它们的用户消息已落库而面板未必已拿到；
    // ⓪ 不需要那条规则，也绝不能借它凭空显示一条消息。
    const entryCancelled = preludeAbortResult();
    if (entryCancelled != null) {
      publishPreludeRunFinished(runtime, scope);
      return entryCancelled;
    }

    // S-13 扩展：每轮发送开头都尝试 backfill 一下历史空窗消息。Step 9 之后新消息
    // 在源头就有 baseline 了，但旧会话里可能还留着没有 checkpoint 的历史消息——
    // 这里幂等地补齐，确保 undo_send 始终能找到可回滚点。已有 checkpoint 的消息不动。
    stage = "backfill-baseline-checkpoints";
    // 传 internalController.signal（r3-run-4）：这段扫描是大会话上秒级的第一站，
    // 用户在这段窗口按停止时在扫描循环内提前退出，而不是被逼着等它跑完。
    await runtime.messageCheckpoint.backfillMissingBaselines(
      scope.sessionId,
      scope.projectId,
      internalController.signal
    );

    stage = "resolve-agent";
    const definition = (
      await mapResolveError(() =>
        resolveAgentForProject(runtime, scope.projectId, scope.sessionId)
      )
    ).definition;

    const hasInput =
      trimmed !== "" || composerAttachOnly.length > 0 || hasAnnotateDrafts;

    if (!hasInput && !allowResumeWithoutInput) {
      throw new AgentTurnError("消息不能为空");
    }
    if (!hasInput && allowResumeWithoutInput) {
      stage = "resume-check-last-message";
      // 只判末条角色：tail(1) 单行读（含 hidden，与全量末条同义）。原先是全量
      // listBySession——含 hidden 整表解压，压缩会话上秒级（2026-09-30 真机
      // 实锤 ~4s：续跑/「继续」按钮每轮白付，且这段前奏无停止观察点，用户
      // 连点停止无响应）。
      const tail = await runtime.messages.listBySessionTail(scope.sessionId, {
        limit: 1,
      });
      // WHY: only resume on trailing user turn to avoid consecutive assistant runs.
      if (tail[tail.length - 1]?.role !== "user") {
        throw new AgentTurnError("消息不能为空");
      }
    }

    stage = "resolve-agent";
    const { savedModelId, workspaceModelId } = await mapResolveError(() =>
      resolveApplicationModelIdForRun(runtime, definition, scope.sessionId)
    );
    // 镜像到 try 之外的变量：catch 块要把它当 onRunFailed 的入参，而它声明在
    // try 内、与 catch 不同作用域。catch 只在 runnerEntered 为真时才读它，
    // 那时该值必然已赋值（`` ?? "" `` 是纯类型兜底，不可达）。
    failureSavedModelId = savedModelId;

  await options?.onAfterResolveModel?.({
    scope,
    definition,
    savedModelId,
    workspaceModelId,
    stream,
  });

  // Scan typed @path / $skill into attach; dedupe with chips; keep tokens in body text.
  const scannedComposer = mergeAttachmentsWithScannedSkills(
    trimmed,
    mergeAttachmentsWithScannedAtPaths(trimmed, composerAttachOnly)
  );

  let checkpointAnchorMessageId: string | undefined;

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
        { linePadding: 0 }
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
    })
  );

  // 新 append：scannedComposer ∪ annotate 直 concat（禁 path 去重）
  const mergedAttachments = [...scannedComposer, ...annotateAttachments];

  const shouldAppendNewUser =
    trimmed !== "" || scannedComposer.length > 0 || hasAnnotateDrafts;

  // S-1：append + capture 这条跨资源写链走 CoordinatedWrite，任一步失败按逆序补偿。
  // append 的补偿是删掉刚写入的消息；capture 的补偿是 release 刚写的 checkpoint。
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
            : undefined
        );
        // S-13 治本：每条新 user 消息都写 baseline checkpoint，确保后续步骤失败时
        // undo_send 仍有可回滚点。原先仅在 user_ops 附件非空时才 capture，
        // 导致普通纯文本 chat 路径无 baseline，undo_send 时 targetTree 空 → 删光工作区。
        // 这里把不变式上提到源头（所有 user append 统一走同一 capture）。
        checkpointAnchorMessageId = appended.id;
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

  // capture 步骤：anchor 来自上面的 append execute（execute 内取值，保证 append 成功后才读到）。
  coordinatedWrite.register({
    name: "capture-baseline-checkpoint",
    execute: async () => {
      const anchorId = checkpointAnchorMessageId;
      if (anchorId == null) return;
      stage = "capture-baseline-checkpoint";
      await runtime.messageCheckpoint.capture(
        scope.sessionId,
        scope.projectId,
        anchorId
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

    // 检查点①：append+capture 已完成（用户消息已落库）——此后的停止不再需要
    // 跑完剩余前奏（校验 / 子代理名单 / 技能装配）才兑现。
    const afterAppendCancelled = preludeAbortResult();
    if (afterAppendCancelled != null) {
      // 同检查点②：先发 FINISHED('') 再返回合成 cancelled（r3-run-1 步骤 1）。
      // 此处用户消息已落库，但本次 run 没跑过任何 step，delta 一条都没有——
      // desktop 侧靠「runId==='' 强制全量 reload」把这条消息捞回面板。
      publishPreludeRunFinished(runtime, scope);
      return afterAppendCancelled;
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

  // 检查点③（r3-run-4，:565 之后）：`agentRegistry.list()` 是前奏尾段的
  // 第一件真 IO 活（拉全部 agent 定义），大会话上窗口不小。停在这里比跑完
  // 后续的 registry resolve + 技能预算装配再兑现快一大截。
  // 语义与①相同（用户消息早已 append 落库），终态同款 FINISHED('')。
  const afterListCancelled = preludeAbortResult();
  if (afterListCancelled != null) {
    publishPreludeRunFinished(runtime, scope);
    return afterListCancelled;
  }

  const callable = allDefs
    .filter((d) => d.mode !== "primary" && d.name !== definition.name)
    .map((d) => ({ name: d.name, description: d.description }));

  const vfs = runtime.sessionVfs(scope.projectId, scope.sessionId);
  // depth=0（主 agent）：task 可用（如有 subagentCallable=true 的子代理）。
  const registry = resolveAgentToolRegistry(toolProbe, definition, {
    depth: 0,
  });
  // skill 工具读取：装配期预算生效技能清单（description lambda 用）。
  // deny 后 registry 不含 skill → 不注入闭包且不产生预算 IO（D4 注册表侧联动）。
  const skillsCtx = await assembleSkillsToolContext(
    runtime,
    scope.projectId,
    registry
  );

  // 检查点④（r3-run-4，:577 之后）：`assembleSkillsToolContext` 里的
  // `effectiveSkills` 是前奏尾段的另一件实打实的 IO（读 KKV + 解析技能目录），
  // 与上面的 list() 之间是真实的秒级窗口——真机上「发送后立刻停止」的停止
  // 意图多半就落在这两步里，必须在这里就被兑现，而不是等 runner 起步后由
  // `loop_start` 拦下。语义与①相同，终态同款 FINISHED('')。
  const afterSkillsCancelled = preludeAbortResult();
  if (afterSkillsCancelled != null) {
    publishPreludeRunFinished(runtime, scope);
    return afterSkillsCancelled;
  }
  // agent 管理工具读取：快照复用上方 allDefs（零新增 IO）；probe 名单透传给
  // 工具内 upsert 的策略校验。registry 不含 agent（子/孙摘除或 deny）时不注入。
  const agentsCtx = assembleAgentsToolContext(
    runtime.agentRegistry,
    allDefs,
    toolProbe.list(),
    registry
  );
  const session = new ChatAgentSession(runtime.messages, scope.sessionId);
  // internalController 由入口 {@link runAgentTurn} 建好并**已注册**（见其注释：
  // 前奏期间的停止不能被丢掉）。这里只取它的 signal：runner.run 用它，
  // 同时作为 task 工具内子 agent run 的 parentSignal，让
  // registry.abort(sessionId) 也能级联到子 run。
  const parentSignal = internalController.signal;
  const toolCtx: BuiltinToolContext = {
    vfs,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
    listSessionMessages: (): Promise<readonly ChatMessage[]> =>
      runtime.messages.listBySession(scope.sessionId),
    sessionKkv: runtime.sessionKkv,
    // 目录规则默认启用：write / mkdir 新路径时按本会话工作区补默认 workplace_dir_rule 行。
    workplace: runtime.workplace({
      kind: "session",
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    }),
    // skill 工具读取：生效清单按本会话 projectId 解析（装配期预算，每 run 一次）。
    ...(skillsCtx != null ? { skills: skillsCtx } : {}),
    // agent 管理工具读取：装配期同步快照（description lambda / list 动作用）。
    ...(agentsCtx != null ? { agents: agentsCtx } : {}),
    // search 工具读取：闭包绑定 runtime.searchConfig（CLI / 旧 mock 未注入时不装配，
    // 工具 run 返回可读错误；引擎解析延迟到 run 内，装配期零 IO）。
    ...(runtime.searchConfig != null
      ? { search: assembleSearchToolContext(runtime.searchConfig) }
      : {}),
    // task 工具读取：depth=0，捕获主 agent run 的 savedModelId/workspaceModelId/signal。
    subagent: {
      agentRegistry: runtime.agentRegistry,
      messages: runtime.messages,
      sessions: runtime.sessions,
      createChildSession: async (title: string): Promise<string> => {
        const child = await runtime.sessions.createSubSession(
          scope.sessionId,
          scope.projectId,
          title
        );
        runtime.eventBus.publish(EVENT_SUBAGENT_CHILD_SESSION_CREATED, {
          parentSessionId: scope.sessionId,
          projectId: scope.projectId,
          childSessionId: child.id,
          title,
        });
        return child.id;
      },
      resolveChildModelId: (
        def: AgentDefinition
      ): { savedModelId: string; workspaceModelId: string } => {
        // 子 agent pin → 父 savedModelId → 报错（不走 workspace fallback）。
        const resolved = resolveSavedModelId({
          agentModelId: def.model,
          sessionModelId: savedModelId,
        });
        if (resolved == null || resolved === "") {
          throw new AgentRunResolveError(
            "子代理未指定模型，且父 agent 也无可用 savedModelId。"
          );
        }
        return { savedModelId: resolved, workspaceModelId };
      },
      runChildAgent: async (
        def: AgentDefinition,
        childSessionId: string,
        opts: RunChildAgentOptions
      ): Promise<AgentRunResult> => {
        return runChildAgent({
          runtime,
          parentProjectId: scope.projectId,
          // 根父会话 id：子 agent 的 VFS / 工作区归属指向它（嵌套时孙 agent 也
          // 指向根父，不指向中间子会话）。
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
    // A-14 path policy：三端共用走 runAgentTurn，这里统一不限制（undefined）；
    // 后续若要按 platform / project 收紧，改成 resolveAllowedPaths(...) 即可。
    allowedPaths: undefined,
    resourceQuota: undefined,
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

    // 检查点②：runner 起步前的最后一道——校验 / 名单 / 技能装配这段尾部也有
    // 秒级窗口（大会话），命中即在此收尾、不注册 streamRegistry（零清理负担）。
    const preRunnerCancelled = preludeAbortResult();
    if (preRunnerCancelled != null) {
      // 先发 FINISHED('') 再返回合成 cancelled——双端据此收口（r3-run-1
      // 步骤 1）。顺序不能反：事件同步分发，返回前事件必须已落到订阅方。
      publishPreludeRunFinished(runtime, scope);
      return preRunnerCancelled;
    }

    // abortRegistry 的注册已在入口完成（见 {@link runAgentTurn}），这里不重复。
    // streamRegistry.register 返回本次 run 的所有权句柄，finally 反注册时回传，
    // 防止同一 sessionId 并发 run 时 A 的 finally 误删 B 的 partial（与 abortRegistry 对称）。
    // 句柄声明在 try 之外：下面的 finally 要读它。
    streamHandle = runtime.streamRegistry?.register(scope.sessionId);

    stage = "runner.run";
    const maxSteps = definition.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS;
    // 终态观测窗：只覆盖 runner.run 调用期间。装上之后 core 发出的任何本 session
    // 真实终态事件都会把 runnerEmittedTerminal 置真，catch 据此决定补不补
    // FAILED('')（细因见该变量的声明注释）。subscribe 本身也走空安全——CLI /
    // 老 mock 的 runtime.eventBus 是占位对象，观测窗装不上只是「看不到终态」，
    // 退化成「可能多补一条 FAILED('')」，绝不会把 run 本身带崩。
    const offTerminalWatch = subscribeQuietly(
      runtime,
      EVENT_AGENT_RUN_FINISHED,
      markRunnerTerminal(),
    );
    const offFailedWatch = subscribeQuietly(
      runtime,
      EVENT_AGENT_RUN_FAILED,
      markRunnerTerminal(),
    );
    // 紧前置真：置真之后的失败才调 onRunFailed（见该变量声明）。
    runnerEntered = true;
    let result: AgentRunResult;
    try {
      result = await runner.run({
        definition,
        sessionId: scope.sessionId,
        projectId: scope.projectId,
        savedModelId,
        workspaceModelId,
        maxSteps,
        stream,
        signal: internalController.signal,
        onStream: options?.onStream,
      });
    } finally {
      // 同步分发下这里退订不会漏事件；退订后 runnerEmittedTerminal 冻结为本 run 的事实。
      offTerminalWatch.unsubscribe();
      offFailedWatch.unsubscribe();
    }
    return result;
  } catch (error) {
    // 收口分岔（r3-run-1 步骤 2）：本函数是「前奏期唯一终态事件出口」。
    //
    // 判据一（终态补发，看 `runnerEmittedTerminal`）：core 全程没发过真实 runId
    // 的终态 —— 前奏抛错、或 runner 自身的前置 IO 在 STARTED 之前就炸了
    // （r3-run-2 把 STARTED 下移后新开的那一小段窗口）——都补发 FAILED(runId:'')
    // 让双端走既有收口链路（composer 解锁 / 错误提示 / refcount 收敛）。
    // 反之 agent-runner 主 try 的 catch 已发过一条**真实 runId** 的 FAILED，
    // 此处绝不补发——否则同一次失败出两条 FAILED、双端双弹 toast。
    if (!runnerEmittedTerminal) {
      publishPreludeRunFailed(runtime, scope, error);
    }
    // 判据二（onRunFailed，看 `runnerEntered`）：只有已经踏进 runner.run 的失败
    // 才回调。前奏失败时 savedModelId 等快照字段尚未解析完毕，语义不成立，
    // 保持既有行为（不调）。注意这一条与判据一是**正交**的——runner 前置 IO
    // 抛错属于「已进 runner 但无终态」，它要补 FAILED('') 且不调 onRunFailed。
    if (runnerEntered) {
      options?.onRunFailed?.({
        stage,
        error,
        scope,
        savedModelId: failureSavedModelId ?? "",
        stream,
      });
    }
    throw error;
  } finally {
    // 反注册带所有权比对：若期间 sessionId 被新 run 覆盖，不误删新 run 的 controller / partial。
    runtime.abortRegistry?.unregister(scope.sessionId, internalController);
    // 句柄为 undefined = 前奏期就抛了、streamRegistry 从未 register。
    // 此刻**不能**反注册：`unregister` 在 handle 省略时按「不带所有权比对直接删」
    // 处理（见 AgentStreamRegistry 注释），会误删同 sessionId 上别的 run 的
    // partial。abortRegistry 的 unregister 走入口壳的 finally，同样幂等。
    if (streamHandle != null) {
      runtime.streamRegistry?.unregister(scope.sessionId, streamHandle);
    }
  }
}

/**
 * `runChildAgent` 内部装配：递归派生子 agent runner（P0-2 / P0-3 / P0-4 / P1-6）。
 *
 * 不抛 "暂未实现" ——本函数是 `task` 工具 `runChildAgent` 闭包背后的真正实现：
 * - VFS（工作区共享）：子 agent `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)`
 *   用父 session 的 VFS 视图——文件只有一个工作区（父 session VFS scope），子 agent 的
 *   read/write/edit/glob/grep 直接落在父工作区；嵌套时孙 agent 同样指向根父会话。
 * - 规则快照隔离：ChatAgentSession 构造时第三位传 parentSessionId（规则评估按父
 *   工作区），第四位 kkvScopeSessionId 走默认值=自身（rule_snapshot / file_cache
 *   存子 session 自己的 KKV）。
 * - abort 派生（P1-6）：`new AbortController()` + `parentSignal.addEventListener("abort", ..., { once: true })`。
 * - registry（P1-10）：`resolveAgentToolRegistry(baseRegistry, def, { depth: parentDepth + 1 })`；
 *   孙 agent（depth >= 2）强制 deny task。
 * - 装配期 vs run 期（P0-2）：`assembleAgentRunnerDeps({ ..., includeCompactionOrchestrator: false })`
 *   是装配期字段，不在 `AgentRunOptions`。
 */
async function runChildAgent(args: {
  readonly runtime: AgentTurnRuntimePort;
  readonly parentProjectId: string;
  /** 根父会话 id（工作区归属；嵌套时透传，不指向中间子会话）。 */
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

  // 子 run 的 scope（终态事件的 payload 归属用，r3-run-3）：
  // sessionId = 子会话自己，projectId = 父会话的项目（子代理共享父工作区）。
  // 与主 run 的 scope 语义对齐，只是 projectId 来自 parentProjectId 而非父
  // sessionId —— 子 run 的 FINISHED('') 必须归属子会话，否则 mobile 子会话页
  // 的 refcount / 停止按钮永远收不到终态。
  const childScope: AgentTurnScope = {
    sessionId: childSessionId,
    projectId: parentProjectId,
  };

  // abort 派生（P1-6）：子 agent 退出/完成不应反向影响父 signal。
  //
  // r3-run-3 前移：本块原先位于 VFS 装配之后，与下面 `try` 里的 register 之间
  // 隔着 baseRegistry 装配 + `agentRegistry.list()`（拉全部 agent 定义）+
  // registry resolve + 技能预算——这段窗口内 childController 还没建好、子
  // 会话页的停止按钮找不到 controller，停止意图**整个丢掉**（不是延迟）。
  // 现在紧跟 childDepth 落地，下面 try 里的 register 紧随其后，中间不留 IO。
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
      { once: true }
    );
  }

  /**
   * 子 run 的前奏检查点（主 run 的同款，判据是 childController.signal）。
   *
   * 与主 run 的差别只有一处：**没有**「用户消息已落库 / 未落库」之分——子 run
   * 唯一的落库动作是 `session.append(prompt)`，它排在两道检查点**之后**，所以
   * 两道命中时子会话里连 task prompt 都还没写，语义比主 run ①②更接近主 run ⓪
   * （「这次派发根本没发生」）。这也正是它们必须**早于** append 的原因。
   */
  const childPreludeAbortResult = (): AgentRunResult | undefined =>
    childController.signal.aborted ? syntheticCancelledResult() : undefined;

  // 子 run controller 挂进 registry，让外部（子会话页停止按钮）能按 childSessionId
  // 中断子 run。r3-run-3 前移：register 从「装配全部完成之后」提到所有前奏 IO
  // 之前（紧跟上面 childController 块），并保持 register 起就纳入 try/finally
  // 包络——覆盖中间每一个 await（list / skills / session.append）抛错的路径，
  // 否则那些 await 一抛错 finally 不执行，registry 留下孤儿 controller。
  // finally 反注册带所有权比对，防误删新 run 的 controller / partial。形态对齐 runAgentTurn。
  // streamHandle 在 try 外声明（同 childController），保证 finally 能读到。
  let streamHandle: string | undefined;
  try {
    runtime.abortRegistry?.register(childSessionId, childController);

    // 子检查点①（r3-run-3）：register 之后、`agentRegistry.list()` 之前。
    //
    // 位置与主 run 的检查点③同构（「list 之前」），并且刻意排在
    // `streamRegistry.register` **之前**——命中即返回，不给子会话页留下一个
    // 永远等不到 delta 的空 partial 条目，零清理负担。
    //
    // 为什么要先发事件再返回（r3-run-1 规则）：子会话页的 in-flight 计数、
    // 停止按钮状态、只读态都靠事件收口，不发 = 子会话页永久卡在「运行中」。
    const childPreListCancelled = childPreludeAbortResult();
    if (childPreListCancelled != null) {
      publishPreludeRunFinished(runtime, childScope);
      return childPreListCancelled;
    }

    // 同主 run：register 拿句柄，finally 反注册时回传做所有权比对。
    streamHandle = runtime.streamRegistry?.register(childSessionId);

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

    // skill（D2）：子代理同样注入，清单按父会话 projectId 解析——
    // 与「子代理共享父工作区」语义一致。子 agent 自己的 policy 同样生效（deny 时不注入）。
    const skillsCtx = await assembleSkillsToolContext(
      runtime,
      parentProjectId,
      registry
    );

    // 子检查点②（r3-run-3）：技能预算之后、`session.append(prompt)` 与
    // `runner.run` 之前。与①同款：命中即发 FINISHED('') 再返回合成 cancelled。
    // 插在这里是因为它是子 run 前奏最后一段实打实的 IO（effectiveSkills 读
    // KKV + 解析技能目录），真机上「子会话页点停止」多半就落在这段窗口。
    const childPostSkillsCancelled = childPreludeAbortResult();
    if (childPostSkillsCancelled != null) {
      publishPreludeRunFinished(runtime, childScope);
      return childPostSkillsCancelled;
    }

    // agent 管理工具：快照复用上方 childAllDefs；probe 名单用 baseRegistry。
    // 子 agent（mode==="subagent"）与孙 agent（depth>=2）被 resolve 摘除，不注入。
    const childAgentsCtx = assembleAgentsToolContext(
      runtime.agentRegistry,
      childAllDefs,
      baseRegistry.list(),
      registry
    );

    // VFS（工作区共享）：子 agent 用父 session 的 VFS 视图——写入直接落在父工作区。
    const vfs = runtime.sessionVfs(parentProjectId, parentSessionId);

    // ChatAgentSession 的消息落子 session（独立历史）；工作区归属指向父 session
    // （子 agent 在父 session 工作区工作，规则评估按父工作区）；KKV 归属走默认值
    // =自身（rule_snapshot / file_cache 存子 session 自己的 KKV，仅快照隔离）。
    const session = new ChatAgentSession(
      runtime.messages,
      childSessionId,
      parentSessionId
    );

    // task 工具的 prompt 作为子 session 的第一条 user 消息落库，
    // 使子 agent 对话历史完整：LLM 能看到任务描述，UI 浏览页也能展示。
    if (opts.prompt && opts.prompt.trim().length > 0) {
      await session.append("user", textBlocks(opts.prompt));
    }
    const toolCtx: BuiltinToolContext = {
      vfs,
      projectId: parentProjectId,
      sessionId: childSessionId,
      listSessionMessages: (): Promise<readonly ChatMessage[]> =>
        runtime.messages.listBySession(childSessionId),
      sessionKkv: runtime.sessionKkv,
      // 目录规则默认启用：子 agent 与父共享同一工作区（上面 vfs 同归属根父会话），
      // 补规则也写父工作区的 workplace_dir_rule。
      workplace: runtime.workplace({
        kind: "session",
        projectId: parentProjectId,
        sessionId: parentSessionId,
      }),
      // skill（D2）：子代理同样注入，清单按父会话 projectId 解析。
      ...(skillsCtx != null ? { skills: skillsCtx } : {}),
      // agent 管理工具：mode==="all" 的子 agent 且 depth<2 时才可能注入（D6 摘除后不注入）。
      ...(childAgentsCtx != null ? { agents: childAgentsCtx } : {}),
      // search：子代理同主代理注入（引擎配置全局共享，解析链与凭据读取在 run 内）。
      ...(runtime.searchConfig != null
        ? { search: assembleSearchToolContext(runtime.searchConfig) }
        : {}),
      // 子 agent 也有 subagent 闭包：递归 depth=childDepth，孙 agent 装配的 registry 已 deny task。
      subagent: {
        agentRegistry: runtime.agentRegistry,
        messages: runtime.messages,
        sessions: runtime.sessions,
        createChildSession: async (title: string): Promise<string> => {
          const grandchild = await runtime.sessions.createSubSession(
            childSessionId,
            parentProjectId,
            title
          );
          runtime.eventBus.publish(EVENT_SUBAGENT_CHILD_SESSION_CREATED, {
            parentSessionId: childSessionId,
            projectId: parentProjectId,
            childSessionId: grandchild.id,
            title,
          });
          return grandchild.id;
        },
        resolveChildModelId: (
          grandchildDef: AgentDefinition
        ): { savedModelId: string; workspaceModelId: string } => {
          // 子 agent pin → 父子 agent 的 savedModelId → 报错（不走 workspace fallback）。
          const resolved = resolveSavedModelId({
            agentModelId: grandchildDef.model,
            sessionModelId: opts.savedModelId,
          });
          if (resolved == null || resolved === "") {
            throw new AgentRunResolveError(
              "孙代理未指定模型，且子 agent 也无可用 savedModelId。"
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
          grandchildOpts: RunChildAgentOptions
        ): Promise<AgentRunResult> => {
          return runChildAgent({
            runtime,
            parentProjectId,
            // 透传根父会话 id：孙 agent 的工作区同样指向根父，不指向中间子会话。
            parentSessionId,
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
      // A-14：子 agent 同样不限制路径。
      allowedPaths: undefined,
      resourceQuota: undefined,
    };

    const runner = createAgentRunner(
      assembleAgentRunnerDeps({
        session,
        runtime,
        registry,
        toolCtx,
        // 装配期 false：子 agent run 不走压缩编排（P0-2）。
        includeCompactionOrchestrator: false,
      })
    );

    // 子会话流式开关（每 run 快照，与 thinkingContext 口径一致）：run 进行中
    // 切开关不影响当次子 run；递归各层闭包捕获同一 runtime，读的是同一偏好。
    // 偏好读失败（如手工写入脏值）时只兜 PreferencesError——回退默认流式并记
    // 标签日志，不炸 run；其余异常重抛，避免静默吞掉装配类 bug。
    let childStream = true;
    try {
      childStream =
        (await runtime.preferences?.getSubagentStreamEnabled()) ?? true;
    } catch (cause) {
      if (!(cause instanceof PreferencesError)) throw cause;
      console.error("[agent-run] subagentStream pref read failed", cause);
    }

    const maxSteps =
      opts.maxSteps ?? def.runtime?.maxSteps ?? DEFAULT_AGENT_MAX_STEPS;
    return await runner.run({
      definition: def,
      sessionId: childSessionId,
      projectId: parentProjectId,
      savedModelId: opts.savedModelId,
      workspaceModelId: opts.workspaceModelId,
      maxSteps,
      // run 期：persistMessages=true 落库供 UI 浏览；publishRunLifecycle=true 发事件供子会话浏览页实时刷新（主会话按 sessionId 过滤不会串）；流式与否由 chat.subagentStream 偏好决定，默认流式；非流式时子会话浏览页无实时增量，靠 STEP_COMMITTED 整步刷新。
      persistMessages: true,
      publishRunLifecycle: true,
      stream: childStream,
      signal: childController.signal,
    });
  } finally {
    // 反注册带所有权比对，防误删新 run 的 controller / partial。
    runtime.abortRegistry?.unregister(childSessionId, childController);
    // 句柄为 undefined = 子检查点①命中（streamRegistry.register 之前就返回了）
    // 或前奏抛错。此时**不能**反注册：unregister 在 handle 省略时按「不带所有权
    // 比对直接删」处理，会误删同 childSessionId 上别的 run 的 partial。与主 run
    // 的 finally 同款（r3-run-3 步骤 3）。
    if (streamHandle != null) {
      runtime.streamRegistry?.unregister(childSessionId, streamHandle);
    }
  }
}
