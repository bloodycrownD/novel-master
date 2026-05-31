/**
 * Agent runner port.
 *
 * @module service/agent/agent.port
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { PromptMacroContext } from "../prompt/render-prompt.js";

export interface AgentRunOptions {
  readonly definition: AgentDefinition;
  /** Resolved applicationModelId (host reads state/flags; Core does not). */
  readonly applicationModelId: string;
  /** Workspace current model id; compaction summary chain falls back here. */
  readonly workspaceModelId: string;
  /** When set, compaction summary chain treats CLI `--modelId` as highest priority. */
  readonly cliModelId?: string;
  readonly promptContext: PromptMacroContext;
  readonly maxSteps?: number;
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
  /** When set with runner regex deps, LLM prompt messages get llm-channel replacement. */
  readonly activeRegexGroupId?: string;
}

/** Drives multi-step model round-trips with tool execution. */
export interface AgentRunner {
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
