/**
 * Token-threshold compaction trigger.
 *
 * @module domain/compaction/triggers/token-threshold.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import type { CompactionModelContext } from "../model/compaction-model-context.js";
import type { CompactionTrigger } from "../ports/compaction-trigger.port.js";

/** Fires when visible message tokens exceed threshold (registry-resolved counter). */
export class TokenThresholdTrigger implements CompactionTrigger {
  constructor(
    private readonly tokenThreshold: number,
    private readonly tokenCounters: TokenCounterRegistry,
  ) {}

  async shouldCompact(
    session: AgentSession,
    modelContext: CompactionModelContext,
  ): Promise<boolean> {
    const visible = await session.list();
    const counter = this.tokenCounters.forApplicationModel(
      modelContext.workspaceModelId,
    );
    return counter.countMessages(visible) > this.tokenThreshold;
  }
}
