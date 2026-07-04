/**
 * Agent runner port.
 *
 * @module service/agent/agent.port
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import type { LlmStreamEvent } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface AgentRunOptions {
  readonly definition: AgentDefinition;
  readonly sessionId: string;
  readonly projectId: string;
  /** Resolved saved model UUID (host reads state/flags; Core does not). */
  readonly savedModelId: string;
  /** Workspace current model id. */
  readonly workspaceModelId: string;
  /** When set, CLI `--modelId` as highest priority for model resolution. */
  readonly cliModelId?: string;
  readonly maxSteps?: number;
  readonly stream?: boolean;
  readonly onStream?: (event: LlmStreamEvent) => void;
  /** When set with runner regex deps, LLM prompt messages get llm-channel replacement. */
  readonly activeRegexGroupId?: string;
  /**
   * When false, assistant/tool turns are kept in an ephemeral overlay only
   * ({@link EphemeralOverlayAgentSession}); default true.
   */
  readonly persistMessages?: boolean;
  /** When false, skip `agent.run.*` / stream bus events; default true. */
  readonly publishRunLifecycle?: boolean;
  /** Aborts an in-flight run from caller UI/runtime controls. */
  readonly signal?: AbortSignal;
}

/** Drives multi-step model round-trips with tool execution. */
export interface AgentRunner {
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
