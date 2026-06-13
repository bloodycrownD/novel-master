/**
 * Agent definition model (prompts, optional model pin, runtime).
 *
 * @module domain/agent/model/agent-definition
 */

import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";

/** Allowlist or denylist tool policy (mutually exclusive). */
export interface AgentToolPolicy {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

/** Serializable agent configuration (Core truth source). */
export interface AgentDefinition {
  readonly name: string;
  readonly prompts: AgentPromptLayout;
  /** Optional default model pin (applicationModelId); host resolves with flag/state. */
  readonly model?: string;
  readonly runtime?: {
    readonly maxSteps?: number;
    readonly doomLoopThreshold?: number;
    readonly doomLoopCrossRoundWindow?: number;
  };
  /** Optional tool allow/deny policy (default: all registered tools). */
  readonly tools?: AgentToolPolicy;
}
