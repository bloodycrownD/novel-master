/**
 * Agent runner: model round-trips, tools, doom loop, event bus integration.
 *
 * @module service/agent/impl/agent-runner
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type {
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "@/domain/chat/model/content-block.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import {
  assertNoCrossRoundDoomLoop,
  assertNoDoomLoopInBlocks,
  CROSS_ROUND_WINDOW,
  DOOM_LOOP_THRESHOLD,
} from "@/domain/agent/logic/doom-loop.js";
import { buildToolResultBlock } from "@/domain/tool/logic/build-tool-result-block.js";
import { anyToolUseMutatesWorkspace } from "@/domain/tool/logic/tool-use-mutates-workspace.js";
import type {
  AgentRunResult,
  ModelRoundSummary,
} from "@/domain/agent/model/agent-run-result.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import {
  ToolRunner,
  type ParallelToolOutcome,
  type ToolCall,
} from "@/domain/tool/logic/tool-runner.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import { ProviderError } from "@/errors/provider-errors.js";
import { PreferencesError } from "@/errors/preferences-errors.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import { toolsFromRegistry } from "@/infra/llm-protocol/logic/tool-definitions.js";
import { pickLastPromptUsage } from "@/infra/tokenizer/logic/pick-last-prompt-usage.js";
import {
  invalidateSessionApiPromptTokenEntry,
  writeSessionApiPromptTokenEntry,
} from "@/infra/tokenizer/logic/session-api-prompt-token-store.js";
import type { ModelRequestService } from "../../provider/model-request.port.js";
import {
  buildPromptLlmInputFromLayout,
  computeLlmExportZonesFromLayout,
} from "../../prompt/render-prompt.js";
import { normalizeOrphanToolResultsForLlm } from "../../prompt/normalize-orphan-tool-results-for-llm.js";
import { applyThinkingContextForLlm } from "../../prompt/apply-thinking-context-for-llm.js";
import { normalizeForLlmExport } from "@/domain/prompt/logic/normalize-for-llm-export.js";
import { prepareUserMessagesForPrompt } from "@/domain/chat/logic/prepare-user-messages-for-prompt.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { inferLlmProtocolFromSavedModelId } from "@/domain/provider/logic/infer-llm-protocol-from-model-id.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { AgentRunOptions, AgentRunner } from "../agent.port.js";
import { EphemeralOverlayAgentSession } from "./ephemeral-overlay-agent-session.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { assembleWorkplaceDisplay } from "@/service/workplace/assemble-workplace-display.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { PromptSkillIndexEntry } from "@/domain/prompt/model/prompt-render-context.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import { runCompaction } from "@/service/compaction-conditions/run-compaction.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "@/service/chat/message-transcript-effects.port.js";
import type { AgentStreamRegistry } from "../agent-stream-registry.port.js";
import type { PersistentPreferences } from "../../persistent-preferences/persistent-preferences.port.js";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_AGENT_STREAM_USAGE,
} from "@/domain/events/model/event-types.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import { generateAgentRunId } from "@/domain/agent/logic/generate-agent-run-id.js";
import { DEFAULT_AGENT_MAX_STEPS } from "../logic/agent-run-max-steps.js";

export interface DefaultAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly savedModels: SavedModelRepository;
  /** 用于自定义服务商协议推断；缺省时仅内置固定 UUID 可解析。 */
  readonly providers?: Pick<ProviderRepository, "findById">;
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  /**
   * skillAttach 附件 hydrate（`$技能` 首次引用附 SKILL.md 全文）的技能服务
   * 工厂；与 toolCtx.skills 同一 SkillService 实例，但不随 D4（skill
   * 被 policy deny）置空——显式引用不受工具禁用影响（SPEC「$ 引用」节）。
   * 未注入时 hydrate 走「原样带过」降级路径。
   */
  readonly skills?: () => SkillService;
  readonly eventBus: SimpleEventBus;
  readonly sessionKkv: SessionKkvService;
  readonly workplace: (scope: VfsScope) => WorkplaceService;
  /**
   * mutating 工具并行 settled 后同步 checkpoint；失败会中断当前 agent run。
   * @remarks 在 append tool_results 之前 await，避免对话继续但无 checkpoint。
   */
  readonly messageCheckpoint?: MessageCheckpointService;
  readonly compactionConditions?: CompactionConditionEvaluator;
  /**
   * 压缩执行所需的消息服务；条件压缩命中时与 messageTranscriptEffects 同进同退。
   * 对话轨由 assembleAgentRunnerDeps 注入。
   */
  readonly messages?: MessageService;
  /** 压缩执行所需的 transcript effects；对话轨由 assembleAgentRunnerDeps 注入。 */
  readonly messageTranscriptEffects?: MessageTranscriptEffectsService;
  /** 按 sessionId 累积 in-flight 流式 partial，供子会话首次进入查询。 */
  readonly streamRegistry?: AgentStreamRegistry;
  readonly listAllSessionMessages?: () => Promise<readonly ChatMessage[]>;
  /** 思考上下文偏好窄切片（每 run 一次快照；未注入时等同默认开）。 */
  readonly preferences?: Pick<
    PersistentPreferences,
    "getThinkingContextEnabled"
  >;
}

/**
 * 从装配期 toolCtx.skills 预算提示词技能索引（Step 10 / D4）。
 *
 * runAgentTurn 装配期已按本会话 projectId 调 SkillService.effectiveSkills
 * 预算生效清单并挂在 toolCtx.skills（与 skill 工具同源）；resolve 后
 * registry 不含 skill（policy deny）时该闭包为空，skillsIndex 随之置空
 * ——工具与索引同进退。
 */
function budgetSkillsIndexEntries(
  toolCtx: BuiltinToolContext
): PromptSkillIndexEntry[] | undefined {
  const skills = toolCtx.skills;
  if (skills == null) {
    return undefined;
  }
  return skills.effective
    .filter((s) => s.effective)
    .map((s) => ({
      name: s.name,
      description: s.description ?? "",
      domain: s.domain,
    }));
}

function truncateRaw(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) {
    return raw;
  }
  return raw.slice(0, maxLen) + "…";
}

/** 避免落库空正文 assistant（真实提示词 #seq 断层、UI 也不展示）。 */
function hasMeaningfulAssistantBlocks(
  blocks: readonly ContentBlock[]
): boolean {
  for (const block of blocks) {
    switch (block.type) {
      case "tool_use":
      case "image":
        return true;
      case "text":
      case "thinking":
        if (block.text.trim() !== "") {
          return true;
        }
        break;
      case "redacted_thinking":
        return true;
      default:
        break;
    }
  }
  return false;
}

/**
 * 从 task 工具的 outcome.output 提取 `subagentSessionId`（P0-1）。
 *
 * 仅 task 工具有该字段；其他工具输出不含 subagentSessionId，返回 undefined。
 * 本函数与 {@link buildToolResultBlock} 内部检测互补：build 内部会优先看 output，
 * 这里显式提取是为了让 agent-runner 调用处意图更明显（C34），便于追踪。
 *
 * phase-1-abort-reflow：导出以供单测固化「中断回流场景仍走同一提取路径」
 * （output.stopped=true 也带 subagentSessionId，本函数不看 stopped，只看
 * subagentSessionId 是否为 string，天然覆盖）。
 */
export function extractSubagentSessionIdFromOutcome(
  outcome:
    | { readonly ok: boolean; readonly output?: unknown }
    | {
        readonly ok: boolean;
        readonly error?: unknown;
      }
): string | undefined {
  if (!outcome.ok) return undefined;
  const output = (outcome as { output?: unknown }).output;
  if (
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { subagentSessionId?: unknown }).subagentSessionId ===
      "string"
  ) {
    return (output as { subagentSessionId: string }).subagentSessionId;
  }
  return undefined;
}

/**
 * Executes agent loops: conditions → LLM → tools → repeat up to maxSteps.
 */
export class DefaultAgentRunner implements AgentRunner {
  private readonly toolRunner: ToolRunner<BuiltinToolContext>;

  constructor(private readonly deps: DefaultAgentRunnerDeps) {
    this.toolRunner = new ToolRunner(deps.registry);
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { sessionId, projectId } = options;
    const persistMessages = options.persistMessages !== false;
    const publishRunLifecycle = options.publishRunLifecycle !== false;
    const bus = this.deps.eventBus;
    const session = persistMessages
      ? this.deps.session
      : new EphemeralOverlayAgentSession(this.deps.session, sessionId);

    const runId = generateAgentRunId();

    // 注意：EVENT_AGENT_RUN_STARTED 的 publish 位置已下移到主 try 紧前
    // （r3-run-2 步骤 1）。原先在 `generateAgentRunId()` 之后立刻发，导致
    // 本段到主 try 之间（savedModels.findById / preferences 读 / wt 解析）
    // 抛错时「STARTED 已发、终态一个都没有」——desktop 侧 refcount 永久泄漏、
    // 后续全部 AGENT_BUSY，mobile 侧靠 .finally 兜住只是侥幸。
    // 下移后这条窗口里的抛错不发 STARTED，由入口壳 run-agent-turn 的收口
    // try 补 FAILED(runId:'')（r3-run-1）——STARTED 与终态天然配对。
    // round-2 已核下移安全：中间无事件、shouldIgnoreStaleRunStarted 恒等
    // !uiRunning、mobile starting 单元由 begin() 建立、listCalibratableSessionIds
    // 语义不变。

    const rounds: ModelRoundSummary[] = [];
    let stepsExecuted = 0;
    let finished = false;
    let stopReason: AgentRunResult["stopReason"] = "max_steps";
    let runError: string | undefined;
    /**
     * 本轮 run 是否已有 assistant 消息落库（含 abort partial）。
     *
     * 失败收尾落错误消息的幂等防御：多步 run 中途失败（如 step N 的
     * doom_loop / 工具链抛错）时，前序 step 的 assistant 已 append——此时
     * 会话尾部为 assistant 或 tool_results user，isPlainUserText 已为
     * false、composer 本就解锁，再追加错误消息只会造成双条提示。
     */
    let assistantAppendedInRun = false;
    const signal = options.signal;
    const toolUseWindow: ToolUseBlock[] = [];
    let vfsMutatedInRun = false;

    const maxSteps =
      options.maxSteps ??
      options.definition.runtime?.maxSteps ??
      DEFAULT_AGENT_MAX_STEPS;
    const doomLoopThreshold =
      options.definition.runtime?.doomLoopThreshold ?? DOOM_LOOP_THRESHOLD;
    const doomLoopCrossRoundWindow =
      options.definition.runtime?.doomLoopCrossRoundWindow ??
      CROSS_ROUND_WINDOW;

    const tools = toolsFromRegistry(this.deps.registry, this.deps.toolCtx);
    // 技能索引预算：消费装配期 toolCtx.skills 的生效清单快照（每 run 一次，
    // 回合内技能启停不即时反映）；skill 被 policy 禁用时闭包为空，
    // 索引随之置空（D4：工具与索引同进退）。
    const skillsIndex = budgetSkillsIndexEntries(this.deps.toolCtx);
    // 常驻工作区前缀 scope：从 session 拿归属 id。主 session 等于自身；子 session
    // 指向父 session（子 agent 在父 session 工作区工作，规则评估与文件列表都按
    // 父工作区）。VFS 也用同一归属 session 视图。
    const wtScope: VfsScope = {
      kind: "session",
      projectId,
      sessionId: session.workplaceScopeSessionId,
    };

    // 宏展开回合快照：时间戳与 $filetree 在 run 开始时取一次，回合内所有 step 复用。
    // 回合内的变更只来自 agent 自己的工具调用（模型已从工具轮次得知），
    // 固定快照不丢信息，且让回合内每步请求成为前一步的纯追加，提升 provider 前缀缓存命中。
    const turnNow = new Date();

    // run 级 usage 累计基线（跨 step 存活）：前序 step 请求 done 后并入的
    // 输出侧终值之和。每 step 流中 usage 事件是 step 口径累计，透传前以
    // 该基线换算为 run 级（多 step 累加），payload 直接带 run 级值、消费端
    // 零算术。经 wrapStreamForBus 的 deps 传入（每 step 重建的包装闭包共享
    // 同一可变基线）。
    const runUsageBase = { completionTokens: 0 };

    // assistant 落库的 model_name 来源（vendorModelId）；每 run 查一次即可。
    // saved model 可能已被删除（悬空引用）：查不到时降级不传该字段。
    const savedModelForAppend = await this.deps.savedModels.findById(
      options.savedModelId
    );

    // 思考上下文偏好（每 run 一次快照，对齐 savedModelForAppend 的读法）：
    // run 中途切换开关不影响进行中的 run，同 run 内各 step 口径一致。
    // KKV 存了坏值（如手工写入 not-a-bool）时 PreferencesError 不炸 run：
    // 回退 false（跟随默认关，与旧版「思考不进上下文」行为一致、无兼容风险）
    // 并记标签日志；GUI 无自愈入口，用户重置偏好后自然恢复。
    let thinkingContextEnabled = false;
    try {
      thinkingContextEnabled =
        (await this.deps.preferences?.getThinkingContextEnabled()) ?? false;
    } catch (error) {
      if (!(error instanceof PreferencesError)) {
        throw error;
      }
      console.error("[agent-runner] thinking_context_pref_read_failed", {
        stage: "thinking_context_pref",
        key: "chat.thinkingContext",
        code: error.code,
        fallback: false,
        error,
      });
    }

    // 档位前置门快照：与 model-request.service 的 thinking 解析同口径
    // （thinkingLevel !== "off" 时才写 body.thinking）。savedModelForAppend
    // 为 null 时取 true——保守保留方向（该请求本身会随 MODEL_NOT_SAVED
    // 校验失败，取值仅占位）。
    const requestThinkingEnabled =
      savedModelForAppend == null ||
      savedModelForAppend.settings.generation.thinkingLevel !== "off";

    /**
     * 统一 abort 处理：置 stopReason，保留已写入的 partial assistant。
     *
     * 所有检测点与 catch 分支命中 AbortError 都走这里，保证 abort 后 stopReason 一致；
     * 已写入的 assistant 消息保留（用户能看到模型刚吐出的内容）。
     */
    const handleAbort = async (_branch: string): Promise<void> => {
      stopReason = "cancelled";
    };

    /**
     * 每 step usage 回锚（统计优先口径，2026-09-29 用户拍板「有哪个统计用
     * 哪个」）：请求完成的 usage 带着精确 promptTokens，落进热层/KKV 后，
     * 下一步的压缩评估与 chip 刷新直接命中 api 档——run 内不再为读数付
     * 本地整串计数（glm 原生大上下文单次 ~5.8s）。
     *
     * 写入点必须在**本 step 全部消息落库之后**（完成/空回复分支与
     * tool_results 落库后，共两个 chokepoint）：`anchorSeq` 是提示词末条
     * 消息的 seq，必须与 usage 对应**同一批可见消息**——锚点后追加的消息
     * 由读口的增量估算覆盖（纯追加不失效基线，2026-09-29 拍板），锚定
     * 早了会把已计入基线的消息再算一遍增量。`lastAnchorSeq` 镜像最后一次
     * 写入携带的锚点（含 undefined），供 run 收尾的终值写沿用——picked
     * 与锚点出自同一步，不会错位。
     */
    let lastAnchorSeq: number | undefined;
    const anchorStepUsage = (
      usage: { readonly promptTokens?: number } | undefined,
      anchorSeq: number | undefined
    ): void => {
      // overlay 内存会话（persistMessages=false）的 usage 不落持久层：
      // append 不落库也不触发失效，写进 KKV 会与 overlay 语义错位。
      if (!persistMessages) {
        return;
      }
      const promptTokens = usage?.promptTokens;
      if (typeof promptTokens !== "number" || !Number.isFinite(promptTokens)) {
        return;
      }
      lastAnchorSeq = anchorSeq;
      writeSessionApiPromptTokenEntry(this.deps.sessionKkv, sessionId, {
        promptTokens,
        atMs: Date.now(),
        savedModelId: options.savedModelId,
        ...(anchorSeq != null ? { anchorSeq } : {}),
      });
    };

    // STARTED 下移落点（r3-run-2）：紧贴主 try 之前，与主 try 的 FAILED /
    // FINISHED 构成「要么都发、要么都不发」的配对（细因见上方 generateAgentRunId
    // 处的注释）。紧邻 try 也保证 publish 与随后的失败处理之间没有其他 await
    // 缝隙——事件到达时下游一定还能看到紧随其后的终态。
    if (publishRunLifecycle) {
      bus.publish(EVENT_AGENT_RUN_STARTED, { sessionId, projectId, runId });
    }

    try {
      // wt 提升到循环外（仅取一次）：工厂每次调用会 new 新服务实例，
      // 每步重建会让 liveViewInFlight 并发去重跨 step 失效。
      const wt = this.deps.workplace(wtScope);
      const turnFiletree = await resolveTurnFiletreeSnapshot(
        options.definition.prompts,
        wt
      );
      for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) {
          await handleAbort("loop_start");
          break;
        }
        let stepCompactionEmitted = false;

        let visible = await session.list();
        if (signal?.aborted) {
          await handleAbort("after_session_list");
          break;
        }

        // assemble 先于 prepare：常驻前缀 S0 计入 seen，与最终提示词可见序一致。
        // 规则评估按 wtScope（子 agent 时=父工作区）；rule_snapshot / file_cache
        // 的 KKV 存取按 session.kkvScopeSessionId（永远=自身，子会话快照隔离）。
        // shouldStop（2026-09-30）：组装段曾是 16s 级无观察点原子块，停止要等
        // 它跑完才能兑现；按文件粒度检查 signal，抛 WorkplaceAssemblyAbortedError
        // 后沿下方 catch 的 signal?.aborted 分支路由进统一 abort 处理。
        const { workplaceDisplay, prefixPaths } =
          await assembleWorkplaceDisplay(
            wtScope,
            {
              sessionKkv: this.deps.sessionKkv,
              workplace: wt,
              vfs: this.deps.toolCtx.vfs,
              layout: options.definition.prompts,
            },
            {
              kkvSessionId: session.kkvScopeSessionId,
              shouldStop: () => signal?.aborted === true,
            }
          );
        if (signal?.aborted) {
          await handleAbort("after_assemble_workplace");
          break;
        }

        visible = await prepareUserMessagesForPrompt(visible, {
          sessionId,
          sessionKkv: this.deps.sessionKkv,
          vfs: this.deps.toolCtx.vfs,
          seenPaths: prefixPaths,
          extraInfo: options.definition.prompts.customAttach,
          now: turnNow,
          workplace: wt,
          filetree: turnFiletree,
          // skillAttach hydrate：`$技能` 首次引用附 SKILL.md 全文。
          // 用 deps.skills 而非 toolCtx.skills——后者在 skill 被 policy
          // deny（D4）时置空，而显式引用不受工具禁用影响。
          skills: this.deps.skills?.(),
          projectId,
        });
        if (signal?.aborted) {
          await handleAbort("after_prepare_user_messages");
          break;
        }

        // API 占用增量锚点：本 step 请求的提示词以这批可见消息为尾，usage
        // 回锚时记下末条 seq，读口据此把「此后追加的消息」折成增量估算。
        const stepAnchorSeq =
          visible.length > 0 ? visible[visible.length - 1]!.seq : undefined;

        // skill load seen 共享（方向 A）：把本请求可见窗口内 `$` 引用过的
        // 技能名回填进 skills 闭包，load 工具据此返回短提示（与 $ 附件
        // 同一可见窗口口径；压缩隐藏后自动重置，下次 load 重新附全文）。
        const skillsSeenCtx = this.deps.toolCtx.skills;
        if (skillsSeenCtx?.referencedNames != null) {
          const names = skillsSeenCtx.referencedNames;
          names.clear();
          for (const m of visible) {
            for (const a of m.attachments ?? []) {
              if (
                a.action === "skillAttach" &&
                typeof a.skillName === "string" &&
                a.skillName !== ""
              ) {
                names.add(a.skillName);
              }
            }
          }
        }

        const promptRenderCtx = {
          workplaceDisplay,
          messages: visible,
          vfs: this.deps.toolCtx.vfs,
          now: turnNow,
          workplace: wt,
          filetree: turnFiletree,
          skillsIndex,
        };
        const promptInput = await buildPromptLlmInputFromLayout(
          options.definition.prompts,
          promptRenderCtx,
          { agentStepIndex: step }
        );

        if (persistMessages && this.deps.compactionConditions != null) {
          const shouldCompact =
            await this.deps.compactionConditions.shouldRequestCompaction(
              this.deps.session,
              {
                sessionId,
                modelContext: {
                  workspaceModelId: options.workspaceModelId,
                  savedModelId: options.savedModelId,
                },
                promptInput,
                layout: options.definition.prompts,
                ctx: promptRenderCtx,
                // 压缩评估的本地估算必须含 tools 段（与 API 口径可比）；
                // sessionKkv 让读口能命中落库的 API 值（跨重启同口径）。
                tools,
                sessionKkv: this.deps.sessionKkv,
              }
            );
          if (signal?.aborted) {
            await handleAbort("after_compaction_eval");
            break;
          }
          if (shouldCompact && !stepCompactionEmitted) {
            // 条件压缩直调化：不再经 eventOrchestrator.emit，改调 runCompaction。
            // messages / messageTranscriptEffects 由 assembleAgentRunnerDeps 在
            // includeCompactionOrchestrator:true 时与 compactionConditions 同注入。
            const messages = this.deps.messages;
            const messageTranscriptEffects = this.deps.messageTranscriptEffects;
            if (messages == null || messageTranscriptEffects == null) {
              throw new Error(
                "messages and messageTranscriptEffects are required when compactionConditions are configured"
              );
            }
            const hideStartDepth =
              await this.deps.compactionConditions!.getHideStartDepth();
            await runCompaction(
              {
                sessionKkv: this.deps.sessionKkv,
                messages,
                messageTranscriptEffects,
              },
              { sessionId, projectId, hideStartDepth }
            );
            stepCompactionEmitted = true;
          }
        }

        const llmInput = promptInput;
        const zones = computeLlmExportZonesFromLayout(
          options.definition.prompts,
          {
            agentStepIndex: step,
            workplaceDisplay,
            skillsIndex,
          }
        );
        const protocol = await inferLlmProtocolFromSavedModelId(
          options.savedModelId,
          this.deps.savedModels,
          this.deps.providers
        );
        const exportMessages = normalizeForLlmExport(
          llmInput.messages,
          protocol,
          zones
        );
        // 思考上下文剥离：normalizeForLlmExport 之后、orphan 归一化之前。
        // 容量 1 判定只看 assistant 消息，与 orphan 归一化顺序无耦合，
        // 此处保持既有插入位置（历史顺序、避免无关行为差异）。
        const strippedMessages = applyThinkingContextForLlm(exportMessages, {
          enabled: thinkingContextEnabled,
          protocol,
          retainProtocolMinimum: true,
          requestThinkingEnabled,
        });
        const llmMessages = normalizeOrphanToolResultsForLlm(strippedMessages);

        // Gemini 的 function-call 名字回查要**含 hidden 的全量历史**（被压缩
        // 掉的早期 tool 往返仍可能被引用），所以这份全量读只在该协议下取：
        // openai / anthropic 适配器不消费它（仅 gemini.adapter 透传），别为
        // 它们每 step 白读一遍全会话正文（大会话上是秒级）。
        let toolUseLookupMessages: readonly ChatMessage[] | undefined;
        if (protocol === "gemini" && this.deps.listAllSessionMessages != null) {
          toolUseLookupMessages = await this.deps.listAllSessionMessages();
        }

        // 计时采集（spec 指标口径）：requestStartedAtMs 为请求发起时刻；
        // 首个内容事件（text-delta / thinking-delta）到达时记 firstContentAtMs。
        // 非流式（无 onStream）时 firstContentAtMs 保持 null，TTFT 取完成时刻。
        const requestStartedAtMs = Date.now();
        let firstContentAtMs: number | null = null;
        const innerOnStream =
          options.stream && publishRunLifecycle
            ? wrapStreamForBus(
                bus,
                sessionId,
                runId,
                {
                  streamRegistry: this.deps.streamRegistry,
                  usageBase: runUsageBase,
                },
                options.onStream
              )
            : options.stream
            ? options.onStream
            : undefined;
        // 在 bus 分发层之外再包一层 timing onStream：只记首个内容事件时刻，
        // 不改变事件流向内层回调；wrapStreamForBus 本身不动。
        const onStream =
          innerOnStream != null
            ? (ev: LlmStreamEvent) => {
                if (
                  firstContentAtMs == null &&
                  (ev.type === "text-delta" || ev.type === "thinking-delta")
                ) {
                  firstContentAtMs = Date.now();
                }
                innerOnStream(ev);
              }
            : undefined;

        let result;
        try {
          result = await this.deps.modelRequests.request(
            options.savedModelId,
            "",
            {
              history: llmMessages,
              toolUseLookupMessages,
              system: llmInput.system,
              tools: tools.length > 0 ? tools : undefined,
              stream: options.stream,
              onStream,
              signal,
            }
          );
        } catch (e: unknown) {
          if (
            signal?.aborted ||
            (e instanceof Error && e.name === "AbortError")
          ) {
            await handleAbort("model_request_catch");
            break;
          }
          throw e;
        }

        // 总时长取 await 结束时刻而非监听 done 事件（done 不经 wrapStreamForBus 转发）。
        const endedAtMs = Date.now();
        const durationMs = endedAtMs - requestStartedAtMs;
        // 非流式请求（无 onStream 或未收到内容事件）TTFT = 总时长（完成时刻口径）。
        const firstTokenMs =
          (firstContentAtMs ?? endedAtMs) - requestStartedAtMs;

        // step done 补发（无论协议）：把该步 LlmChatResult.usage 的输出侧并入
        // run 级累计基线，补发一条 run 级累计 usage 事件。openai 流中无事件段由
        // heuristic 撑显示，到达时终值校正跳正；anthropic/gemini 的 done 终值与
        // 流中累计一致，覆盖无害。usage 缺失（三方网关不给）不并入不补发——
        // 无真值，heuristic 全程撑住。不走 FINISHED 链（usage 属流式旁路，与
        // 生命周期事件解耦）。
        const stepCompletionTokens = result.usage?.completionTokens;
        if (stepCompletionTokens != null) {
          runUsageBase.completionTokens += stepCompletionTokens;
          if (options.stream && publishRunLifecycle) {
            bus.publish(EVENT_AGENT_STREAM_USAGE, {
              sessionId,
              runId,
              completionTokens: runUsageBase.completionTokens,
              source: "usage",
            });
          }
        }

        const meaningful = hasMeaningfulAssistantBlocks(result.blocks);

        // abort 时仍写入 partial assistant（用户能看到模型刚吐出的内容），然后退出
        const aborted = signal?.aborted;
        if (aborted) {
          await handleAbort("post_model");
        }

        stepsExecuted += 1;

        let assistantMessage: ChatMessage | undefined;
        if (result.blocks.length > 0 && meaningful) {
          assistantMessage = await session.append(
            "assistant",
            { blocks: result.blocks },
            {
              // 统计页协议分桶依据：provider 记协议（anthropic/openai/gemini），
              // 与 saved model 的服务商解耦。
              provider: protocol,
              ...(savedModelForAppend != null
                ? {
                    modelName: savedModelForAppend.vendorModelId,
                    // provider×model 维度统计：服务商配置 id 写入时快照，
                    // 服务商后续改名/删除不回写历史行（删除后统计解析不到
                    // 归「其他」，用户已确认可接受）。
                    providerId: savedModelForAppend.providerId,
                  }
                : {}),
              raw: result.raw as Record<string, unknown>,
              // 耗时随 usage 一并落库；result.usage 缺失时仅含两个耗时字段，
              // token 统计仍由 USAGE_NOT_NULL_SQL 把关（缺失行不计入）。
              usage: { ...result.usage, firstTokenMs, durationMs },
            }
          );
          assistantAppendedInRun = true;
          if (publishRunLifecycle) {
            bus.publish(EVENT_AGENT_STEP_COMMITTED, {
              sessionId,
              projectId,
              runId,
              phase: "assistant",
            });
            // per-step reset：assistant 消息已落库，下一步从空累积开始，
            // 避免用户在 step N≥2 重进子会话时拿到 step1+…+stepN 的拼接
            // （前几步已落库文本被当成大 delta 重复推）。reset 只清累积、
            // 不换句柄，run 边界的所有权比对仍由 register/unregister 负责。
            this.deps.streamRegistry?.reset(sessionId);
          }
        }

        // abort 时已写入 partial assistant，不再执行 tool，直接退出
        if (aborted) {
          break;
        }

        // B-2（成功空回复解锁 composer）：model 请求成功但无 meaningful
        // assistant 内容（blocks 为空或全空白文本）时，run 虽以 FINISHED
        // 收尾，但会话尾部停在 user——双端 composer 的连续 user 守卫
        // （lastMessageIsPlainUserText）恒真、输入框锁死。落一条 assistant
        // 占位消息让尾部变 assistant，守卫自然解锁。豁免与失败落消息同款：
        // ① persistMessages=false（EphemeralOverlay run 落了不可见）；
        // ② 本轮已有 assistant 落库（assistantAppendedInRun——多步 run 中途
        //    空回合时尾部是 tool_results user，本就不锁，再落会双条）。
        // 占位不带 usage/raw——模型没有产出可统计的内容，避免脏统计行。
        // 能走到这里且未置位，本 step 必无 tool_use，后继必然 finished。
        if (persistMessages && !assistantAppendedInRun) {
          try {
            await session.append("assistant", {
              blocks: [{ type: "text", text: "（本次生成无内容输出）" }],
            });
            assistantAppendedInRun = true;
          } catch (appendError) {
            // 占位落库失败不把成功 run 翻成 FAILED：记日志后照常收尾。
            console.error(
              "[agent-runner] empty_reply_placeholder_append_failed",
              {
                stage: "empty_reply_placeholder_append",
                sessionId,
                projectId,
                error: appendError,
              }
            );
          }
        }

        const toolUses = result.blocks.filter(
          (b): b is ToolUseBlock => b.type === "tool_use"
        );

        if (toolUses.length === 0) {
          // chokepoint ①：完成/空回复路径的全部落库已结束，回锚本 step 的
          // usage（下一步评估与 chip 刷新命中 api 档；见 anchorStepUsage 注释）。
          anchorStepUsage(result.usage, stepAnchorSeq);
          finished = true;
          stopReason = "completed";
          rounds.push({
            step,
            hadToolUse: false,
            finished: true,
            usage: result.usage,
          });
          break;
        }

        rounds.push({
          step,
          hadToolUse: true,
          finished: false,
          usage: result.usage,
        });

        assertNoDoomLoopInBlocks(result.blocks, {
          threshold: doomLoopThreshold,
        });
        for (const toolUse of toolUses) {
          toolUseWindow.push(toolUse);
          if (toolUseWindow.length > doomLoopCrossRoundWindow * 4) {
            toolUseWindow.shift();
          }
        }
        assertNoCrossRoundDoomLoop(toolUseWindow, {
          crossRoundWindow: doomLoopCrossRoundWindow,
        });

        if (signal?.aborted) {
          await handleAbort("before_tool_run");
          break;
        }

        const degradedById = new Map(
          (result.degradedToolCalls ?? []).map((d) => [d.id, d] as const)
        );
        const outcomes: Array<ParallelToolOutcome | null> = [];
        const runnableCalls: ToolCall[] = [];

        for (const tu of toolUses) {
          const degraded = degradedById.get(tu.id);
          if (degraded != null) {
            outcomes.push({
              ok: false,
              error: new ProviderError(
                "INVALID_TOOL_ARGUMENTS",
                `${protocol}: invalid tool arguments JSON (${truncateRaw(
                  degraded.rawArguments,
                  80
                )})`
              ),
            });
            continue;
          }
          runnableCalls.push({ name: tu.name, input: tu.input });
          outcomes.push(null);
        }

        const parallelResults = await this.toolRunner.runParallel(
          runnableCalls,
          this.deps.toolCtx
        );
        let parallelIdx = 0;
        for (let i = 0; i < outcomes.length; i++) {
          if (outcomes[i] == null) {
            outcomes[i] = parallelResults[parallelIdx]!;
            parallelIdx += 1;
          }
        }

        const vfsMutated = anyToolUseMutatesWorkspace(toolUses);
        vfsMutatedInRun = vfsMutatedInRun || vfsMutated;
        const toolResults: ToolResultBlock[] = toolUses.map((tu, i) =>
          buildToolResultBlock(tu.id, outcomes[i]!, {
            toolName: tu.name,
            // 工具操作落到的 VFS scope 归属者（子 agent 写入落父 session scope）。
            vfsScope: {
              kind: "session",
              projectId,
              sessionId: session.workplaceScopeSessionId,
            },
            // task 工具输出对象含 subagentSessionId：透传到 ToolResultBlock.meta（P0-1）。
            // buildToolResultBlock 内部还会从 outcome.output.subagentSessionId 自动检测。
            subagentSessionId: extractSubagentSessionIdFromOutcome(
              outcomes[i]!
            ),
            // skill：read 缺省域命中生效副本的解析结果由输出携带，
            // projectId 上下文从这里补进 meta.skillRef（T-SK8）。
            skillProjectId: projectId,
          })
        );

        if (
          vfsMutated &&
          persistMessages &&
          assistantMessage != null &&
          this.deps.messageCheckpoint != null
        ) {
          try {
            await this.deps.messageCheckpoint.capture(
              sessionId,
              projectId,
              assistantMessage.id
            );
          } catch (error) {
            console.error("[agent-runner] checkpoint_capture_failed", {
              stage: "checkpoint_capture",
              sessionId,
              projectId,
              messageId: assistantMessage.id,
              error,
            });
            throw error;
          }
        }

        if (signal?.aborted) {
          await handleAbort("after_tool_checkpoint");
          break;
        }
        await session.append("user", { blocks: toolResults });
        // chokepoint ②：tool_results 落库后回锚本 step 的 usage（锚点与
        // usage 对齐到同一批可见消息——纯追加不失效基线，下一步评估走
        // api 档零计数、锚点后增量由读口覆盖）。
        anchorStepUsage(result.usage, stepAnchorSeq);
        if (publishRunLifecycle) {
          bus.publish(EVENT_AGENT_STEP_COMMITTED, {
            sessionId,
            projectId,
            runId,
            phase: "tool_results",
            vfsMutated,
          });
        }

        if (step + 1 >= maxSteps) {
          stopReason = "max_steps";
          break;
        }
      }
    } catch (e: unknown) {
      if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
        // catch 命中 AbortError：走统一 abort 处理（保留 partial）
        await handleAbort("catch_abort");
      } else {
        runError = e instanceof Error ? e.message : String(e);
        // 失败收尾落一条 assistant 错误消息：会话尾部变 assistant 后，双端
        // composer 的连续 user 守卫（lastMessageIsPlainUserText）自然解锁，
        // 失败原因也从一次性 toast 变为持久可回查。豁免两条：
        // ① persistMessages=false（EphemeralOverlay run，append 只进内存，
        //    run 结束即丢，落了也不可见）；② 本轮已有 assistant 落库
        //    （assistantAppendedInRun——秒败路径必然无 assistant：assistant
        //    仅在 model request 成功返回后 append，request 抛错时标志必为
        //    false；多步中途失败时尾部已是 assistant / tool_results user，
        //    isPlainUserText 已为 false，无需再落，避免双条）。
        // 落库须先于 FAILED 事件发出，保证下游 tail reload 时能读到这条消息。
        if (persistMessages && !assistantAppendedInRun) {
          try {
            await session.append("assistant", {
              blocks: [{ type: "text", text: `[生成失败] ${runError}` }],
            });
          } catch (appendError) {
            // 错误消息落库失败不掩盖原始错误：记日志后继续发 FAILED 并抛原错。
            console.error("[agent-runner] failure_message_append_failed", {
              stage: "failure_message_append",
              sessionId,
              projectId,
              error: appendError,
            });
          }
        }
        // FAILED / 非 Abort throw 不到达 FINISHED：必清 API 占用（进程内热层 +
        // session KKV 行双删），避免重启后从 KKV 读回旧值。
        // run 收尾不等 IO：这里刻意保持 fire-and-forget（不 await KKV 删除）。
        void invalidateSessionApiPromptTokenEntry(
          this.deps.sessionKkv,
          sessionId
        );
        if (publishRunLifecycle) {
          bus.publish(EVENT_AGENT_RUN_FAILED, {
            sessionId,
            projectId,
            runId,
            error: runError,
          });
        }
        throw e;
      }
    }

    if (publishRunLifecycle) {
      bus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId,
        projectId,
        runId,
        stopReason,
        vfsMutated: vfsMutatedInRun,
      });
    }

    // 仅 completed ∧ pick 有值（含合法 0）写缓存；FINISHED 旁路其他一律失效。
    // 写侧落 session KKV（进程内热层 + KKV 双写）：重启后仍读到同一份 API
    // 口径的占用，不再出现「重启前报 API、重启后跌本地估算」的跳表。
    // anchorSeq 沿用本 run 最后一次回锚的锚点（picked 与锚点同源同 step；
    // 终 step usage 缺 promptTokens 而 picked 取自前步时，锚点也是前步的）。
    // persistMessages=false（overlay run）的终值同样不落——锚点口径属持久
    // 会话，与 anchorStepUsage / 失败消息落库同一条豁免，走 else 连旧值失效。
    const picked = pickLastPromptUsage(rounds);
    if (
      persistMessages &&
      stopReason === "completed" &&
      picked !== undefined
    ) {
      writeSessionApiPromptTokenEntry(this.deps.sessionKkv, sessionId, {
        promptTokens: picked,
        atMs: Date.now(),
        savedModelId: options.savedModelId,
        ...(lastAnchorSeq != null ? { anchorSeq: lastAnchorSeq } : {}),
      });
    } else {
      // run 收尾不等 IO：这里刻意保持 fire-and-forget（不 await KKV 删除）。
      void invalidateSessionApiPromptTokenEntry(
        this.deps.sessionKkv,
        sessionId
      );
    }

    return {
      stepsExecuted,
      finished,
      stopReason,
      rounds,
    };
  }
}

/**
 * @internal Exposed for stream-bus deferral unit tests.
 *
 * 这里不再为每个 stream event 各自 `queueMicrotask`：那样 N 个 event 会插进 N 条微任务，
 * 中间可能被其它微任务（订阅者倒序调用、scheduler 等）插入，跨批次顺序不稳。
 *
 * 改成单个"合并刷新"：同一同步批次的全部 stream event 先压进 `pendingQueue`，只调度一次
 * `queueMicrotask(flush)`。flush 里按 FIFO 顺序逐条 publish，保证批次内顺序确定、
 * 批次间也只有一个微任务槽位，跨批次顺序不会被随机插入打乱。bus.publish 仍然不在调用方
 * 同步执行（避免订阅者中途回访 runner 产生的重入）。
 */
export function wrapStreamForBus(
  bus: SimpleEventBus,
  sessionId: string,
  runId: string,
  deps: {
    readonly streamRegistry?: AgentStreamRegistry;
    /**
     * run 级 usage 累计基线（跨 step 存活；step 循环外创建、随 run 生命周期
     * 存取）。流中 usage 事件是 step 口径累计，换算 run 级 = 基线 + step 累计。
     */
    readonly usageBase?: { completionTokens: number };
  } = {},
  userOnStream?: (event: LlmStreamEvent) => void
): ((event: LlmStreamEvent) => void) | undefined {
  // 待发布的 bus event 列表；同一同步批次内累积，由唯一一个 microtask 一次性 flush。
  const pendingQueue: Array<() => void> = [];
  let flushScheduled = false;

  const scheduleFlush = (): void => {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
      // 先重置调度标志，让 flush 期间新加入的事件能在下一个微任务里再排（保留批语义）。
      flushScheduled = false;
      const drain = pendingQueue.splice(0, pendingQueue.length);
      for (const publish of drain) {
        publish();
      }
    });
  };

  const enqueuePublish = (publish: () => void): void => {
    pendingQueue.push(publish);
    scheduleFlush();
  };

  const scheduleStreamPublish = (ev: LlmStreamEvent): void => {
    if (ev.type === "text-delta") {
      deps.streamRegistry?.append(sessionId, { text: ev.text });
      enqueuePublish(() =>
        bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
          sessionId,
          runId,
          text: ev.text,
        })
      );
    } else if (ev.type === "thinking-delta") {
      deps.streamRegistry?.append(sessionId, { thinking: ev.text });
      enqueuePublish(() =>
        bus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
          sessionId,
          runId,
          text: ev.text,
        })
      );
    } else if (ev.type === "tool-use") {
      enqueuePublish(() =>
        bus.publish(EVENT_AGENT_STREAM_TOOL_USE, {
          sessionId,
          runId,
          id: ev.id,
          name: ev.name,
          input: ev.input,
        })
      );
    } else if (ev.type === "usage") {
      // step 口径累计 → run 级换算：基线（前序 step 终值之和）+ 本 step 累计。
      // 基线随每 step done 后的补发并基线推进（见 run() 内 done 补发）。
      const stepCompletion = ev.usage.completionTokens;
      if (stepCompletion != null) {
        const runCompletion = (deps.usageBase?.completionTokens ?? 0) + stepCompletion;
        enqueuePublish(() =>
          bus.publish(EVENT_AGENT_STREAM_USAGE, {
            sessionId,
            runId,
            completionTokens: runCompletion,
            source: "usage",
          })
        );
      }
    }
  };

  if (userOnStream == null) {
    return scheduleStreamPublish;
  }

  return (ev: LlmStreamEvent) => {
    scheduleStreamPublish(ev);
    userOnStream(ev);
  };
}

/**
 * 汇总会参与宏展开的文本：customAttach（trim 非空即生效）与开启 dynamic 区的块内容。
 * persist 区不做宏展开（原样注入），不参与预检。
 */
function collectMacroExpandableText(layout: AgentPromptLayout): string {
  const parts: string[] = [];
  if (typeof layout.customAttach === "string") {
    parts.push(layout.customAttach);
  }
  if (layout.dynamicEnabled === true) {
    for (const block of layout.dynamic) {
      parts.push(block.content);
    }
  }
  return parts.join("\n");
}

/**
 * 回合快照预取：文本含 `$filetree` 时渲染一次供回合内全部 step 复用，
 * 否则返回 undefined（回退实时渲染，等价旧行为——不含该宏时也不会走到渲染）。
 */
async function resolveTurnFiletreeSnapshot(
  layout: AgentPromptLayout,
  workplace: WorkplaceService
): Promise<string | undefined> {
  if (!collectMacroExpandableText(layout).includes("$filetree")) {
    return undefined;
  }
  return workplace.renderFileTree();
}
