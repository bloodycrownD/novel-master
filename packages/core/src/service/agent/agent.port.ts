/**
 * Agent runner port.
 *
 * @module service/agent/agent.port
 */

import type { AgentRunResult } from "@/domain/agent/agent-run-result.js";
import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/adapter.port.js";
import type { PromptRenderContext } from "../prompt/render-prompt.js";

export interface AgentRunOptions {
  readonly maxSteps: number;
  readonly applicationModelId: string;
  readonly promptBlocks: readonly PromptBlock[];
  readonly promptContext: PromptRenderContext;
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
}

/** Drives multi-step model round-trips with tool execution. */
export interface AgentRunner {
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
