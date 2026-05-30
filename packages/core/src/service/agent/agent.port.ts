/**
 * Agent runner port.
 *
 * @module service/agent/agent.port
 */

import type { AgentDefinition } from "@/domain/agent/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/agent-run-result.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/adapter.port.js";
import type { PromptRenderContext } from "../prompt/render-prompt.js";

export interface AgentRunOptions {
  readonly definition: AgentDefinition;
  /** Resolved applicationModelId (host reads state/flags; Core does not). */
  readonly applicationModelId: string;
  /** When set, compaction summary chain treats CLI `--modelId` as highest priority. */
  readonly cliModelId?: string;
  readonly promptContext: Omit<PromptRenderContext, "messages" | "abstract">;
  readonly maxSteps?: number;
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
}

/** Drives multi-step model round-trips with tool execution. */
export interface AgentRunner {
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
