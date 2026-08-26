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
import { depthByMessageId } from "@/domain/depth/logic/depth-from-tail.js";
import { listVisibleForDepth } from "@/domain/depth/logic/depth-from-tail.js";
import { applyRegexChannelToMessages } from "@/domain/regex/logic/apply-regex-rules.js";
import { resolveActiveCompiledRules } from "@/domain/regex/logic/resolve-active-regex-rules.js";
import {
  assertNoCrossRoundDoomLoop,
  assertNoDoomLoopInBlocks,
  CROSS_ROUND_WINDOW,
  DOOM_LOOP_THRESHOLD,
} from "@/domain/agent/logic/doom-loop.js";
import { buildToolResultBlock } from "@/domain/tool/logic/build-tool-result-block.js";
import { anyToolUseMutatesWorkspace } from "@/domain/tool/logic/tool-use-mutates-workspace.js";
import type { AgentRunResult, ModelRoundSummary } from "@/domain/agent/model/agent-run-result.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import { ToolRunner, type ParallelToolOutcome, type ToolCall } from "@/domain/tool/logic/tool-runner.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import { ProviderError } from "@/errors/provider-errors.js";
import type { MessageCheckpointService } from "@/service/message-checkpoint/message-checkpoint.port.js";
import { toolsFromRegistry } from "@/infra/llm-protocol/logic/tool-definitions.js";
import { pickLastPromptUsage } from "@/infra/tokenizer/logic/pick-last-prompt-usage.js";
import { sessionApiPromptTokenCache } from "@/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import type { ModelRequestService } from "../../provider/model-request.port.js";import { buildPromptLlmInputFromLayout, computeLlmExportZonesFromLayout } from "../../prompt/render-prompt.js";
import { applyRegexChannelForLlm } from "../../prompt/apply-regex-channel-for-llm.js";
import { normalizeOrphanToolResultsForLlm } from "../../prompt/normalize-orphan-tool-results-for-llm.js";
import { applyThinkingContextForLlm } from "../../prompt/apply-thinking-context-for-llm.js";
import { normalizeForLlmExport } from "@/domain/prompt/logic/normalize-for-llm-export.js";
import { prepareUserMessagesForPrompt } from "@/domain/chat/logic/prepare-user-messages-for-prompt.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { inferLlmProtocolFromSavedModelId } from "@/domain/provider/logic/infer-llm-protocol-from-model-id.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { RegexConfigService } from "../../regex/regex-config.port.js";
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
  readonly regexConfig?: RegexConfigService;
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
  blocks: readonly ContentBlock[],
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
  outcome: { readonly ok: boolean; readonly output?: unknown } | {
    readonly ok: boolean; readonly error?: unknown;
  },
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
    const session =
      persistMessages
        ? this.deps.session
        : new EphemeralOverlayAgentSession(this.deps.session, sessionId);

    const runId = generateAgentRunId();

    if (publishRunLifecycle) {
      bus.publish(EVENT_AGENT_RUN_STARTED, { sessionId, projectId, runId });
    }

    const rounds: ModelRoundSummary[] = [];
    let stepsExecuted = 0;
    let finished = false;
    let stopReason: AgentRunResult["stopReason"] = "max_steps";
    let runError: string | undefined;
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
      options.definition.runtime?.doomLoopCrossRoundWindow ?? CROSS_ROUND_WINDOW;

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

    // assistant 落库的 model_name 来源（vendorModelId）；每 run 查一次即可。
    // saved model 可能已被删除（悬空引用）：查不到时降级不传该字段。
    const savedModelForAppend = await this.deps.savedModels.findById(
      options.savedModelId,
    );

    // 思考上下文偏好（每 run 一次快照，对齐 savedModelForAppend 的读法）：
    // run 中途切换开关不影响进行中的 run，同 run 内各 step 口径一致。
    const thinkingContextEnabled =
      (await this.deps.preferences?.getThinkingContextEnabled()) ?? true;

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

    try {
      // wt 提升到循环外（仅取一次）：工厂每次调用会 new 新服务实例，
      // 每步重建会让 liveViewInFlight 并发去重跨 step 失效。
      const wt = this.deps.workplace(wtScope);
      const turnFiletree = await resolveTurnFiletreeSnapshot(
        options.definition.prompts,
        wt,
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
        visible = await applyLlmRegexChannelToVisible(
          this.deps,
          options,
          visible,
        );
        if (signal?.aborted) {
          await handleAbort("after_regex_channel");
          break;
        }

        // assemble 先于 prepare：常驻前缀 S0 计入 seen，与最终提示词可见序一致。
        // 规则评估按 wtScope（子 agent 时=父工作区）；rule_snapshot / file_cache
        // 的 KKV 存取按 session.kkvScopeSessionId（永远=自身，子会话快照隔离）。
        const { workplaceDisplay, prefixPaths } = await assembleWorkplaceDisplay(
          wtScope,
          {
            sessionKkv: this.deps.sessionKkv,
            workplace: wt,
            vfs: this.deps.toolCtx.vfs,
            layout: options.definition.prompts,
          },
          { kkvSessionId: session.kkvScopeSessionId },
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
          { agentStepIndex: step },
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
              },
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
                "messages and messageTranscriptEffects are required when compactionConditions are configured",
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
              { sessionId, projectId, hideStartDepth },
            );
            stepCompactionEmitted = true;
          }
        }

        const llmInput = promptInput;
        const zones = computeLlmExportZonesFromLayout(options.definition.prompts, {
          agentStepIndex: step,
          workplaceDisplay,
          skillsIndex,
        });
        const protocol = await inferLlmProtocolFromSavedModelId(
          options.savedModelId,
          this.deps.savedModels,
          this.deps.providers,
        );
        const exportMessages = normalizeForLlmExport(
          llmInput.messages,
          protocol,
          zones,
        );
        // 思考上下文剥离：normalizeForLlmExport 之后、orphan 归一化之前——
        // orphan 归一化会把孤立 tool_result 拍平成 text 块，拍平后的 user
        // 消息会误判为「真实用户输入」把边界错误前移。
        const strippedMessages = applyThinkingContextForLlm(exportMessages, {
          enabled: thinkingContextEnabled,
          protocol,
          retainProtocolMinimum: true,
          requestThinkingEnabled,
        });
        const llmMessages = normalizeOrphanToolResultsForLlm(strippedMessages);

        let toolUseLookupMessages: readonly ChatMessage[] | undefined;
        if (this.deps.listAllSessionMessages != null) {
          toolUseLookupMessages = await this.deps.listAllSessionMessages();
        }

        const onStream =
          options.stream && publishRunLifecycle
            ? wrapStreamForBus(
                bus,
                sessionId,
                runId,
                { streamRegistry: this.deps.streamRegistry },
                options.onStream,
              )
            : options.stream
              ? options.onStream
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
            },
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
                ? { modelName: savedModelForAppend.vendorModelId }
                : {}),
              raw: result.raw as Record<string, unknown>,
              ...(result.usage != null ? { usage: result.usage } : {}),
            },
          );
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

        const toolUses = result.blocks.filter(
          (b): b is ToolUseBlock => b.type === "tool_use",
        );

        if (toolUses.length === 0) {
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

        assertNoDoomLoopInBlocks(result.blocks, { threshold: doomLoopThreshold });
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
          (result.degradedToolCalls ?? []).map((d) => [d.id, d] as const),
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
                `${protocol}: invalid tool arguments JSON (${truncateRaw(degraded.rawArguments, 80)})`,
              ),
            });
            continue;
          }
          runnableCalls.push({ name: tu.name, input: tu.input });
          outcomes.push(null);
        }

        const parallelResults = await this.toolRunner.runParallel(
          runnableCalls,
          this.deps.toolCtx,
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
            subagentSessionId: extractSubagentSessionIdFromOutcome(outcomes[i]!),
            // skill：read 缺省域命中生效副本的解析结果由输出携带，
            // projectId 上下文从这里补进 meta.skillRef（T-SK8）。
            skillProjectId: projectId,
          }),
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
              assistantMessage.id,
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
        // FAILED / 非 Abort throw 不到达 FINISHED：必清 API 缓存，避免残留旧值
        sessionApiPromptTokenCache.clear(sessionId);
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

    // 仅 completed ∧ pick 有值（含合法 0）写缓存；FINISHED 旁路其他一律 clear
    const picked = pickLastPromptUsage(rounds);
    if (stopReason === "completed" && picked !== undefined) {
      sessionApiPromptTokenCache.set(sessionId, {
        promptTokens: picked,
        updatedAt: Date.now(),
      });
    } else {
      sessionApiPromptTokenCache.clear(sessionId);
    }

    return {
      stepsExecuted,
      finished,
      stopReason,
      rounds,
    };
  }
}

async function applyLlmRegexChannelToVisible(
  deps: DefaultAgentRunnerDeps,
  options: AgentRunOptions,
  visible: readonly ChatMessage[],
): Promise<ChatMessage[]> {
  if (!options.activeRegexGroupId || deps.regexConfig == null) {
    return [...visible];
  }
  if (deps.listAllSessionMessages != null) {
    const all = await deps.listAllSessionMessages();
    return applyRegexChannelForLlm(
      deps.regexConfig,
      options.activeRegexGroupId,
      all,
      visible,
    );
  }
  const rules = await resolveActiveCompiledRules(
    deps.regexConfig,
    options.activeRegexGroupId,
  );
  if (rules.length === 0) {
    return [...visible];
  }
  const visibleSorted = listVisibleForDepth(visible);
  const depthMap = depthByMessageId(visibleSorted);
  return applyRegexChannelToMessages(visible, rules, "llm", depthMap);
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
  deps: { readonly streamRegistry?: AgentStreamRegistry } = {},
  userOnStream?: (event: LlmStreamEvent) => void,
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
        }),
      );
    } else if (ev.type === "thinking-delta") {
      deps.streamRegistry?.append(sessionId, { thinking: ev.text });
      enqueuePublish(() =>
        bus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
          sessionId,
          runId,
          text: ev.text,
        }),
      );
    } else if (ev.type === "tool-use") {
      enqueuePublish(() =>
        bus.publish(EVENT_AGENT_STREAM_TOOL_USE, {
          sessionId,
          runId,
          id: ev.id,
          name: ev.name,
          input: ev.input,
        }),
      );
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
  workplace: WorkplaceService,
): Promise<string | undefined> {
  if (!collectMacroExpandableText(layout).includes("$filetree")) {
    return undefined;
  }
  return workplace.renderFileTree();
}
