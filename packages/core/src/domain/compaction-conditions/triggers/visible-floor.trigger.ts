/**
 * Visible-floor compaction condition (count > floor).
 *
 * @module domain/compaction-conditions/triggers/visible-floor.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type {
  CompactionEvaluationContext,
  CompactionConditionTrigger,
} from "../ports/compaction-condition-trigger.port.js";

/** Fires when visible message count strictly exceeds visibleFloor. */
export class VisibleFloorTrigger implements CompactionConditionTrigger {
  constructor(private readonly visibleFloor: number) {}

  async shouldTrigger(
    session: AgentSession,
    _evaluation: CompactionEvaluationContext,
  ): Promise<boolean> {
    const visible = await session.list();
    return visible.length > this.visibleFloor;
  }
}
