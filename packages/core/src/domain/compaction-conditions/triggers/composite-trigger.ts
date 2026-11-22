/**
 * OR composite compaction condition trigger.
 *
 * @module domain/compaction-conditions/triggers/composite-trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { CompactionEvaluationContext, CompactionConditionTrigger } from "../ports/compaction-condition-trigger.port.js";

/** Any child satisfied → trigger fires. */
export class CompositeConditionTrigger implements CompactionConditionTrigger {
    constructor(private readonly triggers: readonly CompactionConditionTrigger[]) {}

    async shouldTrigger(session: AgentSession, evaluation: CompactionEvaluationContext): Promise<Result<boolean, AppError>> {
        for (const trigger of this.triggers) {
            const r = await trigger.shouldTrigger(session, evaluation);
            if (!r.ok) return r;
            if (r.value) {
                return Result.ok(true);
            }
        }
        return Result.ok(false);
    }
}
