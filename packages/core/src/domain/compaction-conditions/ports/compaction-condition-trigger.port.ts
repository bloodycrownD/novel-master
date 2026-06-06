/**
 * Compaction condition trigger port (OR semantics via composite).
 *
 * @module domain/compaction-conditions/ports/compaction-condition-trigger.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";
import type {
  PromptLlmInput,
  PromptRenderContext,
} from "@/service/prompt/render-prompt.js";

export interface CompactionConditionModelContext {
  readonly workspaceModelId: string;
  readonly applicationModelId: string;
}

export interface CompactionEvaluationContext {
  readonly modelContext: CompactionConditionModelContext;
  readonly promptInput: PromptLlmInput;
  readonly blocks: readonly PromptBlock[];
  readonly ctx: PromptRenderContext;
}

/** Returns true when this trigger slice is satisfied. */
export interface CompactionConditionTrigger {
  shouldTrigger(
    session: AgentSession,
    evaluation: CompactionEvaluationContext,
  ): Promise<boolean>;
}
