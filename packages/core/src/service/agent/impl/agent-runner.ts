/**
 * Agent runner: model round-trips, tools, doom loop, event bus integration.
 *
 * @module service/agent/impl/agent-runner
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ToolResultBlock, ToolUseBlock } from "@/domain/chat/model/content-block.js";
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
import type { ModelRequestService } from "../../provider/model-request.port.js";
import { buildPromptLlmInputFromLayout, computeLlmExportZonesFromLayout } from "../../prompt/render-prompt.js";
import { applyRegexChannelForLlm } from "../../prompt/apply-regex-channel-for-llm.js";
import { normalizeOrphanToolResultsForLlm } from "../../prompt/normalize-orphan-tool-results-for-llm.js";
import { normalizeForLlmExport } from "@/domain/prompt/logic/normalize-for-llm-export.js";
import { inferLlmProtocolFromSavedModelId } from "@/domain/provider/logic/infer-llm-protocol-from-model-id.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { RegexConfigService } from "../../regex/regex-config.port.js";
import type { AgentRunOptions, AgentRunner } from "../agent.port.js";
import { EphemeralOverlayAgentSession } from "./ephemeral-overlay-agent-session.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { SessionWorktreeBlockStore } from "@/service/prompt/session-worktree-block.port.js";
import { getCapturedBlockOrCapture } from "@/service/prompt/capture-session-worktree-block.js";
import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_SESSION_COMPACTION_REQUESTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
} from "@/domain/events/model/event-types.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import { generateAgentRunId } from "@/domain/agent/logic/generate-agent-run-id.js";
import { DEFAULT_AGENT_MAX_STEPS } from "../logic/agent-run-max-steps.js";

export interface DefaultAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly savedModels: SavedModelRepository;
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  readonly eventBus: SimpleEventBus;
  readonly worktreeBlockStore: SessionWorktreeBlockStore;
  readonly worktree: (scope: VfsScope) => WorktreeService;
  /**
   * mutating ���߲��� settled ��ͬ�� capture��ʧ�ܻ��жϵ�ǰ agent run��
   * @remarks �� append tool_results ֮ǰ await������Ի��������� checkpoint��
   */
  readonly messageCheckpoint?: MessageCheckpointService;
  readonly compactionConditions?: CompactionConditionEvaluator;
  /** Runs hide-message before prompt build on condition trigger (not bus.publish). */
  readonly eventOrchestrator?: EventOrchestrator;
  readonly regexConfig?: RegexConfigService;
  readonly listAllSessionMessages?: () => Promise<readonly ChatMessage[]>;
}

function truncateRaw(raw: string, maxLen: number): string {
  if (raw.length <= maxLen) {
    return raw;
  }
  return raw.slice(0, maxLen) + "…";
}

/**
 * Executes agent loops: conditions �?LLM �?tools �?repeat up to maxSteps.
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
    let assistantAppendCount = 0;
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

    const tools = toolsFromRegistry(this.deps.registry);
    const wtScope: VfsScope = {
      kind: "session",
      projectId,
      sessionId,
    };

    try {
      await getCapturedBlockOrCapture(wtScope, {
        worktree: this.deps.worktree,
        worktreeBlockStore: this.deps.worktreeBlockStore,
      });

      for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) {
          stopReason = "cancelled";
          break;
        }
        let stepCompactionEmitted = false;

        const block = this.deps.worktreeBlockStore.getCapturedBlock(
          projectId,
          sessionId,
        );
        if (block == null) {
          throw new Error("worktree 块未 capture");
        }

        let visible = await session.list();
        if (signal?.aborted) {
          stopReason = "cancelled";
          break;
        }
        visible = await applyLlmRegexChannelToVisible(
          this.deps,
          options,
          visible,
        );
        if (signal?.aborted) {
          stopReason = "cancelled";
          break;
        }

        const wt = this.deps.worktree(wtScope);
        const promptRenderCtx = {
          worktreeDisplay: block.worktreeDisplay,
          messages: visible,
          vfs: this.deps.toolCtx.vfs,
          worktree: wt,
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
            stopReason = "cancelled";
            break;
          }
          if (shouldCompact && !stepCompactionEmitted) {
            const orchestrator = this.deps.eventOrchestrator;
            if (orchestrator == null) {
              throw new Error(
                "eventOrchestrator is required when compactionConditions are configured",
              );
            }
            await orchestrator.emit(EVENT_SESSION_COMPACTION_REQUESTED, {
              sessionId,
              projectId,
              trigger: "condition",
            });
            stepCompactionEmitted = true;
          }
        }

        const llmInput = promptInput;
        const zones = computeLlmExportZonesFromLayout(options.definition.prompts, {
          agentStepIndex: step,
        });
        const protocol = await inferLlmProtocolFromSavedModelId(
          options.savedModelId,
          this.deps.savedModels,
        );
        const exportMessages = normalizeForLlmExport(
          llmInput.messages,
          protocol,
          zones,
        );
        const llmMessages = normalizeOrphanToolResultsForLlm(exportMessages);

        let toolUseLookupMessages: readonly ChatMessage[] | undefined;
        if (this.deps.listAllSessionMessages != null) {
          toolUseLookupMessages = await this.deps.listAllSessionMessages();
        }

        const onStream =
          options.stream && publishRunLifecycle
            ? wrapStreamForBus(bus, sessionId, runId, options.onStream)
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
            stopReason = "cancelled";
            break;
          }
          throw e;
        }

        stepsExecuted += 1;

        let assistantMessage: ChatMessage | undefined;
        if (result.blocks.length > 0) {
          assistantMessage = await session.append("assistant", { blocks: result.blocks }, {
            raw: result.raw as Record<string, unknown>,
          });
          assistantAppendCount += 1;
          if (publishRunLifecycle) {
            bus.publish(EVENT_AGENT_STEP_COMMITTED, {
              sessionId,
              projectId,
              runId,
              phase: "assistant",
            });
          }
        }

        if (signal?.aborted) {
          stopReason = "cancelled";
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
          stopReason = "cancelled";
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
            vfsScope: { kind: "session", projectId, sessionId },
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
          stopReason = "cancelled";
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
        stopReason = "cancelled";
      } else {
      runError = e instanceof Error ? e.message : String(e);
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

    /**
     * session.message.received 不受 publishRunLifecycle 门控；compaction 等 orchestrator action 经 bus 异步执行。
     * 本方法成功返回不表示下游 action 已成功。
     */
    if (persistMessages && assistantAppendCount > 0) {
      bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, { sessionId, projectId });
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

/** @internal Exposed for stream-bus deferral unit tests. */
export function wrapStreamForBus(
  bus: SimpleEventBus,
  sessionId: string,
  runId: string,
  userOnStream?: (event: LlmStreamEvent) => void,
): ((event: LlmStreamEvent) => void) | undefined {
  const scheduleStreamPublish = (ev: LlmStreamEvent): void => {
    if (ev.type === "text-delta") {
      queueMicrotask(() =>
        bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
          sessionId,
          runId,
          text: ev.text,
        }),
      );
    } else if (ev.type === "thinking-delta") {
      queueMicrotask(() =>
        bus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
          sessionId,
          runId,
          text: ev.text,
        }),
      );
    } else if (ev.type === "tool-use") {
      queueMicrotask(() =>
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
