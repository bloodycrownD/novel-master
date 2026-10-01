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
    evaluation: CompactionEvaluationContext
  ): Promise<boolean> {
    // runner 已在本 step 开头 list() 过一次（visible.length），透传进来复用即可，
    // 不必再发第二次全会话读（RT-02）。缺省时回落到自己 list()，保持旧行为。
    const visibleCount =
      evaluation.visibleMessageCount ?? (await session.list()).length;
    return visibleCount > this.visibleFloor;
  }
}
