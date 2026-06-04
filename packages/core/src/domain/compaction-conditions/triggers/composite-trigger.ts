/**
 * OR composite compaction condition trigger.
 *
 * @module domain/compaction-conditions/triggers/composite-trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type {
  CompactionEvaluationContext,
  CompactionConditionTrigger,
} from "../ports/compaction-condition-trigger.port.js";

/** Any child satisfied → trigger fires. */
export class CompositeConditionTrigger implements CompactionConditionTrigger {
  constructor(private readonly triggers: readonly CompactionConditionTrigger[]) {}

  async shouldTrigger(
    session: AgentSession,
    evaluation: CompactionEvaluationContext,
  ): Promise<boolean> {
    for (const trigger of this.triggers) {
      if (await trigger.shouldTrigger(session, evaluation)) {
        return true;
      }
    }
    return false;
  }
}
