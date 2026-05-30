/**
 * Token-threshold compaction trigger.
 *
 * @module domain/compaction/triggers/token-threshold.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import { estimateTokens } from "@/service/compaction/token-estimate.js";
import type { CompactionTrigger } from "../compaction-trigger.port.js";

/** Fires when estimated visible tokens exceed threshold. */
export class TokenThresholdTrigger implements CompactionTrigger {
  constructor(private readonly tokenThreshold: number) {}

  async shouldCompact(session: AgentSession): Promise<boolean> {
    const visible = await session.list();
    return estimateTokens(visible) > this.tokenThreshold;
  }
}
