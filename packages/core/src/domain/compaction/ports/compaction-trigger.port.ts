/**
 * Compaction trigger port (when to compact).
 *
 * @module domain/compaction/compaction-trigger.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { CompactionModelContext } from "../model/compaction-model-context.js";

/** Returns true when the session should run compaction action. */
export interface CompactionTrigger {
  shouldCompact(
    session: AgentSession,
    modelContext: CompactionModelContext,
  ): Promise<boolean>;
}
