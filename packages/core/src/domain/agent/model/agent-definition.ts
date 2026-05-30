/**
 * Agent definition model (prompts, optional model pin, runtime).
 *
 * @module domain/agent/model/agent-definition
 */

import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";

/** Serializable agent configuration (Core truth source). */
export interface AgentDefinition {
  readonly name: string;
  readonly prompts: readonly PromptBlock[];
  /** Optional default model pin (applicationModelId); host resolves with flag/state. */
  readonly model?: string;
  readonly runtime?: { readonly maxSteps?: number };
}
