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
import { assertNoDoomLoopInBlocks } from "@/domain/agent/logic/doom-loop.js";
import { formatToolOutputForLlm } from "@/domain/tool/logic/format-tool-output.js";
import type { AgentRunResult, ModelRoundSummary } from "@/domain/agent/model/agent-run-result.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "@/domain/tool/logic/tool-runner.js";
import type { VfsToolContext } from "@/domain/tool/builtin/vfs-tools.js";
import { toolsFromRegistry } from "@/infra/llm-protocol/logic/tool-definitions.js";
import type { ModelRequestService } from "../../provider/model-request.port.js";
import { buildPromptLlmInput } from "../../prompt/render-prompt.js";
import type { RegexConfigService } from "../../regex/regex-config.port.js";
import type { AgentRunOptions, AgentRunner } from "../agent.port.js";
import { EphemeralOverlayAgentSession } from "./ephemeral-overlay-agent-session.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { SessionMacroCache } from "@/service/prompt/session-macro-cache.port.js";
import type { CompactionConditionEvaluator } from "@/service/compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "@/service/events/event-orchestrator.port.js";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_SESSION_COMPACTION_REQUESTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
} from "@/domain/events/model/event-types.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface DefaultAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly registry: ToolRegistry<VfsToolContext>;
  readonly toolCtx: VfsToolContext;
  readonly eventBus: SimpleEventBus;
  readonly macroCache: SessionMacroCache;
  readonly compactionConditions?: CompactionConditionEvaluator;
  /** Runs hide-message / refresh-macros before prompt build on condition trigger (not bus.publish). */
  readonly eventOrchestrator?: EventOrchestrator;
  readonly regexConfig?: RegexConfigService;
  readonly listAllSessionMessages?: () => Promise<readonly ChatMessage[]>;
}

const DEFAULT_MAX_STEPS = 20;

/**
 * Executes agent loops: conditions → LLM → tools → repeat up to maxSteps.
 */
export class DefaultAgentRunner implements AgentRunner {
  private readonly toolRunner: ToolRunner<VfsToolContext>;

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

    if (publishRunLifecycle) {
      bus.publish(EVENT_AGENT_RUN_STARTED, { sessionId, projectId });
    }

    const rounds: ModelRoundSummary[] = [];
    let stepsExecuted = 0;
    let finished = false;
    let stopReason: AgentRunResult["stopReason"] = "max_steps";
    let assistantAppendCount = 0;
    let runError: string | undefined;

    const maxSteps =
      options.maxSteps ??
      options.definition.runtime?.maxSteps ??
      DEFAULT_MAX_STEPS;

    const tools = toolsFromRegistry(this.deps.registry);

    try {
      for (let step = 0; step < maxSteps; step++) {
        let stepCompactionEmitted = false;
        if (persistMessages && this.deps.compactionConditions != null) {
          const shouldCompact =
            await this.deps.compactionConditions.shouldRequestCompaction(
              this.deps.session,
              {
                workspaceModelId: options.workspaceModelId,
                applicationModelId: options.applicationModelId,
              },
            );
          if (shouldCompact && !stepCompactionEmitted) {
            const orchestrator = this.deps.eventOrchestrator;
            if (orchestrator == null) {
              throw new Error(
                "eventOrchestrator is required when compactionConditions are configured",
              );
            }
            // Direct emit (awaited): hide + macro refresh complete before prompt build.
            // Do not bus.publish here — attachToBus would run the same actions again.
            await orchestrator.emit(EVENT_SESSION_COMPACTION_REQUESTED, {
              sessionId,
              projectId,
              trigger: "condition",
            });
            stepCompactionEmitted = true;
          }
        }

        const macro = this.deps.macroCache.get(projectId, sessionId);
        const promptContext = {
          worktreeDisplay: macro?.worktreeDisplay ?? "",
          filetreeDisplay: macro?.filetreeDisplay ?? "",
        };

        let visible = await session.list();
        if (options.activeRegexGroupId && this.deps.regexConfig) {
          const rules = await resolveActiveCompiledRules(
            this.deps.regexConfig,
            options.activeRegexGroupId,
          );
          if (rules.length > 0 && this.deps.listAllSessionMessages) {
            const all = await this.deps.listAllSessionMessages();
            const visibleSorted = listVisibleForDepth(all);
            const depthMap = depthByMessageId(visibleSorted);
            visible = applyRegexChannelToMessages(
              visible,
              rules,
              "llm",
              depthMap,
            );
          }
        }
        const llmInput = buildPromptLlmInput(options.definition.prompts, {
          ...promptContext,
          messages: visible,
        });

        const onStream =
          options.stream && publishRunLifecycle
            ? wrapStreamForBus(bus, sessionId, options.onStream)
            : options.stream
              ? options.onStream
              : undefined;

        const result = await this.deps.modelRequests.request(
          options.applicationModelId,
          "",
          {
            history: llmInput.messages,
            system: llmInput.system,
            tools: tools.length > 0 ? tools : undefined,
            stream: options.stream,
            onStream,
          },
        );

        stepsExecuted += 1;

        await session.append("assistant", { blocks: result.blocks }, {
          raw: result.raw as Record<string, unknown>,
        });
        assistantAppendCount += 1;

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

        assertNoDoomLoopInBlocks(result.blocks);

        const toolResults: ToolResultBlock[] = [];
        for (const tu of toolUses) {
          let content: string;
          try {
            const out = await this.toolRunner.call(
              tu.name,
              tu.input,
              this.deps.toolCtx,
            );
            content = formatToolOutputForLlm(out);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            content = `Error: ${msg}`;
          }
          toolResults.push({
            type: "tool_result",
            toolUseId: tu.id,
            content,
          });
        }

        await session.append("user", { blocks: toolResults });

        if (step + 1 >= maxSteps) {
          stopReason = "max_steps";
          break;
        }
      }
    } catch (e: unknown) {
      runError = e instanceof Error ? e.message : String(e);
      if (publishRunLifecycle) {
        bus.publish(EVENT_AGENT_RUN_FAILED, {
          sessionId,
          projectId,
          error: runError,
        });
      }
      throw e;
    }

    if (persistMessages && assistantAppendCount > 0) {
      bus.publish(EVENT_SESSION_MESSAGE_RECEIVED, { sessionId, projectId });
    }

    if (publishRunLifecycle) {
      bus.publish(EVENT_AGENT_RUN_FINISHED, {
        sessionId,
        projectId,
        stopReason,
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

function wrapStreamForBus(
  bus: SimpleEventBus,
  sessionId: string,
  userOnStream?: (event: LlmStreamEvent) => void,
): ((event: LlmStreamEvent) => void) | undefined {
  if (userOnStream == null) {
    return (ev: LlmStreamEvent) => {
      if (ev.type === "text-delta") {
        bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
          sessionId,
          text: ev.text,
        });
      } else if (ev.type === "thinking-delta") {
        bus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
          sessionId,
          text: ev.text,
        });
      }
    };
  }
  return (ev: LlmStreamEvent) => {
    if (ev.type === "text-delta") {
      bus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, { sessionId, text: ev.text });
    } else if (ev.type === "thinking-delta") {
      bus.publish(EVENT_AGENT_STREAM_THINKING_DELTA, {
        sessionId,
        text: ev.text,
      });
    }
    userOnStream(ev);
  };
}
