/**
 * Agent definition model (prompts, compaction, model, runtime).
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

/** Flat OR trigger: token estimate or visible message floor. */
export interface CompactionTriggerConfig {
  readonly tokenThreshold?: number;
  readonly floorThreshold?: number;
}

/** Static text abstract (macro-expanded) or LLM-generated summary. */
export type CompactionAbstractConfig =
  | { readonly type: "text"; readonly content: string }
  | { readonly type: "agent"; readonly instruction?: string };

/** Compaction action: hide older messages and produce abstract text. */
export interface CompactionActionConfig {
  readonly keepLastN: number;
  readonly abstract: CompactionAbstractConfig;
}

/** Optional compaction policy on an agent definition. */
export interface CompactConfig {
  readonly trigger: CompactionTriggerConfig;
  readonly action: CompactionActionConfig;
}

/** Serializable agent configuration (Core truth source). */
export interface AgentDefinition {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly prompts: readonly PromptBlock[];
  readonly model: AgentModelConfig;
  readonly compact?: CompactConfig;
  readonly runtime?: { readonly maxSteps?: number };
}
