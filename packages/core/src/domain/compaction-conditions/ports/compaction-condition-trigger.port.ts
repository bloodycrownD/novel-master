/**
 * Compaction condition trigger port (OR semantics via composite).
 *
 * @module domain/compaction-conditions/ports/compaction-condition-trigger.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";

export interface CompactionConditionModelContext {
  readonly workspaceModelId: string;
  readonly applicationModelId: string;
}

/** Returns true when this trigger slice is satisfied. */
export interface CompactionConditionTrigger {
  shouldTrigger(
    session: AgentSession,
    modelContext: CompactionConditionModelContext,
  ): Promise<boolean>;
}
