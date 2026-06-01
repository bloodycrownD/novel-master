/**
 * Token-threshold compaction condition (supports -1 and ratio).
 *
 * @module domain/compaction-conditions/triggers/token-threshold.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import type {
  CompactionConditionModelContext,
  CompactionConditionTrigger,
} from "../ports/compaction-condition-trigger.port.js";

export interface TokenThresholdTriggerOptions {
  readonly tokenThreshold: number;
  readonly tokenRatio?: number;
  readonly resolveMaxContextTokens: (
    modelContext: CompactionConditionModelContext,
  ) => Promise<number>;
}

/** Fires when visible tokens exceed effective threshold. */
export class TokenThresholdConditionTrigger implements CompactionConditionTrigger {
  constructor(
    private readonly options: TokenThresholdTriggerOptions,
    private readonly tokenCounters: TokenCounterRegistry,
  ) {}

  async shouldTrigger(
    session: AgentSession,
    modelContext: CompactionConditionModelContext,
  ): Promise<boolean> {
    let threshold = this.options.tokenThreshold;
    if (threshold === -1) {
      threshold = await this.options.resolveMaxContextTokens(modelContext);
    }
    const ratio = this.options.tokenRatio ?? 1;
    const effective = Math.floor(threshold * ratio);

    const visible = await session.list();
    const counter = await this.tokenCounters.forApplicationModel(
      modelContext.applicationModelId,
    );
    return counter.countMessages(visible) > effective;
  }
}
