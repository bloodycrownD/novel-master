/**
 * Floor-threshold compaction trigger (visible message count).
 *
 * @module domain/compaction/triggers/floor-threshold.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { CompactionTrigger } from "../compaction-trigger.port.js";

/** Fires when visible message count exceeds floor (hidden messages excluded). */
export class FloorThresholdTrigger implements CompactionTrigger {
  constructor(private readonly floorThreshold: number) {}

  async shouldCompact(session: AgentSession): Promise<boolean> {
    const visible = await session.list();
    return visible.length > this.floorThreshold;
  }
}
