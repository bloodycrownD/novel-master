/**
 * Token-ratio compaction condition (v3; uses persisted context window).
 *
 * @module domain/compaction-conditions/triggers/token-ratio.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import { countPromptLlmInput } from "@/infra/tokenizer/logic/count-prompt-llm-input.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import type {
  CompactionEvaluationContext,
  CompactionConditionTrigger,
} from "../ports/compaction-condition-trigger.port.js";

export interface TokenRatioTriggerOptions {
  readonly tokenRatio: number;
  readonly resolveContextWindow: (
    evaluation: CompactionEvaluationContext,
  ) => Promise<number | null>;
  /** Per-model tokenizer override (same source as Chat / CLI token counts). */
  readonly resolveTokenizerOverride: (
    evaluation: CompactionEvaluationContext,
  ) => Promise<TokenizerOverride>;
}

/** Fires when full prompt tokens exceed `floor(contextWindow * tokenRatio)`. */
export class TokenRatioConditionTrigger implements CompactionConditionTrigger {
  constructor(
    private readonly options: TokenRatioTriggerOptions,
    private readonly tokenCounters: TokenCounterRegistry,
  ) {}

  async shouldTrigger(
    _session: AgentSession,
    evaluation: CompactionEvaluationContext,
  ): Promise<boolean> {
    const contextWindow = await this.options.resolveContextWindow(evaluation);
    if (contextWindow == null) {
      return false;
    }
    const effective = Math.floor(contextWindow * this.options.tokenRatio);

    const tokenizerOverride =
      await this.options.resolveTokenizerOverride(evaluation);
    const { tokenCount } = await countPromptLlmInput({
      layout: evaluation.layout,
      ctx: evaluation.ctx,
      applicationModelId: evaluation.modelContext.applicationModelId,
      registry: this.tokenCounters,
      tokenizerOverride,
    });
    return tokenCount > effective;
  }
}
