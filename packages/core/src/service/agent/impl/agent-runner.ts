/**
 * Agent runner: model round-trips, tools, doom loop, compaction.
 *
 * @module service/agent/impl/agent-runner
 */

import type { ToolResultBlock, ToolUseBlock } from "@/domain/chat/model/content-block.js";
import type { AgentSession } from "@/domain/agent/agent-session.port.js";
import { assertNoDoomLoopInBlocks } from "@/domain/agent/doom-loop.js";
import type { AgentRunResult, ModelRoundSummary } from "@/domain/agent/agent-run-result.js";
import type { ToolRegistry } from "@/domain/tool/tool-registry.js";
import { ToolRunner } from "@/domain/tool/tool-runner.js";
import type { VfsToolContext } from "@/domain/tool/builtin/vfs-tools.js";
import { toolsFromRegistry } from "@/infra/llm-protocol/tool-definitions.js";
import type { ModelRequestService } from "../../provider/model-request.port.js";
import type { CompactionService } from "../../compaction/compaction.port.js";
import { buildPromptLlmInput } from "../../prompt/render-prompt.js";
import type { AgentRunOptions, AgentRunner } from "../agent.port.js";

export interface DefaultAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly registry: ToolRegistry<VfsToolContext>;
  readonly toolCtx: VfsToolContext;
  readonly compaction: CompactionService;
}

/**
 * Executes agent loops: compaction → LLM → tools → repeat up to maxSteps.
 */
export class DefaultAgentRunner implements AgentRunner {
  private readonly toolRunner: ToolRunner<VfsToolContext>;

  constructor(private readonly deps: DefaultAgentRunnerDeps) {
    this.toolRunner = new ToolRunner(deps.registry);
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const rounds: ModelRoundSummary[] = [];
    let stepsExecuted = 0;
    let finished = false;
    let stopReason: AgentRunResult["stopReason"] = "max_steps";

    const tools = toolsFromRegistry(this.deps.registry);

    for (let step = 0; step < options.maxSteps; step++) {
      await this.deps.compaction.maybeCompact(
        this.deps.session,
        options.applicationModelId,
      );

      const visible = await this.deps.session.list();
      const llmInput = buildPromptLlmInput(options.promptBlocks, {
        ...options.promptContext,
        messages: visible,
      });

      const result = await this.deps.modelRequests.request(
        options.applicationModelId,
        "",
        {
          history: llmInput.messages,
          system: llmInput.system,
          tools: tools.length > 0 ? tools : undefined,
          stream: options.stream,
          onStream: options.onStream,
        },
      );

      stepsExecuted += 1;

      await this.deps.session.append("assistant", { blocks: result.blocks }, {
        raw: result.raw as Record<string, unknown>,
      });

      const toolUses = result.blocks.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        finished = true;
        stopReason = "completed";
        rounds.push({ step, hadToolUse: false, finished: true });
        break;
      }

      rounds.push({ step, hadToolUse: true, finished: false });

      // doom_loop boundary: same name + same JSON input in last 3 tool_use blocks
      assertNoDoomLoopInBlocks(result.blocks);

      const toolResults: ToolResultBlock[] = [];
      for (const tu of toolUses) {
        let content: string;
        try {
          const out = await this.toolRunner.call(tu.name, tu.input, this.deps.toolCtx);
          content =
            typeof out === "string" ? out : JSON.stringify(out, null, 2);
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

      // tool_result blocks go on a user message (Anthropic protocol alignment)
      await this.deps.session.append("user", { blocks: toolResults });

      // maxSteps=1: execute tools but do not start another model round-trip
      if (step + 1 >= options.maxSteps) {
        stopReason = "max_steps";
        break;
      }
    }

    return {
      stepsExecuted,
      finished,
      stopReason,
      rounds,
    };
  }
}
