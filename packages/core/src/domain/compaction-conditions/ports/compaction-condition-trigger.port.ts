/**
 * Compaction condition trigger port (OR semantics via composite).
 *
 * @module domain/compaction-conditions/ports/compaction-condition-trigger.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type {
  PromptLlmInput,
  PromptRenderContext,
} from "@/domain/prompt/model/prompt-render-context.js";

export interface CompactionConditionModelContext {
  readonly workspaceModelId: string;
  readonly savedModelId: string;
}

export interface CompactionEvaluationContext {
  readonly modelContext: CompactionConditionModelContext;
  readonly promptInput: PromptLlmInput;
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
}

/** Returns true when this trigger slice is satisfied. */
export interface CompactionConditionTrigger {
  shouldTrigger(
    session: AgentSession,
    evaluation: CompactionEvaluationContext,
  ): Promise<boolean>;
}
