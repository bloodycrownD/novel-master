/**
 * Agent definition model (prompts, model, runtime).
 *
 * @module domain/agent/agent-definition
 */

import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";
import type { ModelSamplingParams } from "./model/model-sampling-params.js";

/** Model invocation section of an agent definition. */
export interface AgentModelConfig {
  readonly applicationModelId: string;
  readonly params?: ModelSamplingParams;
}

/** Serializable agent configuration (Core truth source). */
export interface AgentDefinition {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly prompts: readonly PromptBlock[];
  readonly model: AgentModelConfig;
  readonly runtime?: { readonly maxSteps?: number };
}
