/**
 * Token-threshold compaction condition (supports -1 and ratio).
 *
 * @module domain/compaction-conditions/triggers/token-threshold.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import { countPromptLlmInput } from "@/infra/tokenizer/logic/count-prompt-llm-input.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import type {
  CompactionEvaluationContext,
  CompactionConditionTrigger,
} from "../ports/compaction-condition-trigger.port.js";

export interface TokenThresholdTriggerOptions {
  readonly tokenThreshold: number;
  readonly tokenRatio?: number;
  readonly resolveMaxContextTokens: (
    evaluation: CompactionEvaluationContext,
  ) => Promise<number>;
}

/** Fires when full prompt tokens exceed effective threshold. */
export class TokenThresholdConditionTrigger implements CompactionConditionTrigger {
  constructor(
    private readonly options: TokenThresholdTriggerOptions,
    private readonly tokenCounters: TokenCounterRegistry,
  ) {}

  async shouldTrigger(
    _session: AgentSession,
    evaluation: CompactionEvaluationContext,
  ): Promise<boolean> {
    let threshold = this.options.tokenThreshold;
    if (threshold === -1) {
      threshold = await this.options.resolveMaxContextTokens(evaluation);
    }
    const ratio = this.options.tokenRatio ?? 1;
    const effective = Math.floor(threshold * ratio);

    const { tokenCount } = await countPromptLlmInput({
      input: evaluation.promptInput,
      applicationModelId: evaluation.modelContext.applicationModelId,
      registry: this.tokenCounters,
    });
    return tokenCount > effective;
  }
}
