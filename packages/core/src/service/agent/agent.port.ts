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
  readonly sessionId: string;
  readonly projectId: string;
  /** Resolved applicationModelId (host reads state/flags; Core does not). */
  readonly applicationModelId: string;
  /** Workspace current model id. */
  readonly workspaceModelId: string;
  /** When set, CLI `--modelId` as highest priority for model resolution. */
  readonly cliModelId?: string;
  /** Legacy: macro strings; runner reads {@link SessionMacroCache} when set. */
  readonly promptContext?: PromptMacroContext;
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
