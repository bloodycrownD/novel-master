/**
 * OR composite compaction trigger.
 *
 * @module domain/compaction/triggers/composite-trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { CompactionTrigger } from "../ports/compaction-trigger.port.js";

/** compaction OR boundary: any child trigger satisfied → compact. */
export class CompositeTrigger implements CompactionTrigger {
  constructor(private readonly triggers: readonly CompactionTrigger[]) {}

  async shouldCompact(session: AgentSession): Promise<boolean> {
    for (const trigger of this.triggers) {
      if (await trigger.shouldCompact(session)) {
        return true;
      }
    }
    return false;
  }
}
