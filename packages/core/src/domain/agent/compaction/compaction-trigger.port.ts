/**
 * Compaction trigger port (when to compact).
 *
 * @module domain/agent/compaction/compaction-trigger.port
 */

import type { AgentSession } from "@/domain/agent/agent-session.port.js";

/** Returns true when the session should run compaction action. */
export interface CompactionTrigger {
  shouldCompact(session: AgentSession): Promise<boolean>;
}
