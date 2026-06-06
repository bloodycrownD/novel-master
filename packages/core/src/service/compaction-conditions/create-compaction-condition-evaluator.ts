/**
 * Factory for compaction condition evaluation (OR triggers).
 *
 * @module service/compaction-conditions/create-compaction-condition-evaluator
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import { CompositeConditionTrigger } from "@/domain/compaction-conditions/triggers/composite-trigger.js";
import { VisibleFloorTrigger } from "@/domain/compaction-conditions/triggers/visible-floor.trigger.js";
import { TokenRatioConditionTrigger } from "@/domain/compaction-conditions/triggers/token-ratio.trigger.js";
import type {
  CompactionConditionTrigger,
  CompactionEvaluationContext,
} from "@/domain/compaction-conditions/ports/compaction-condition-trigger.port.js";
import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import type { ProviderModelService } from "@/service/provider/provider-model.port.js";
import type { CompactionConditionsStore } from "./compaction-conditions-store.port.js";

/**
 * Evaluates persisted compaction conditions (OR triggers) against a session.
 * Does not hide messages or refresh macros — on true, the caller should
 * {@link EventOrchestrator.emit} `session.compaction.requested` (awaited in AgentRunner).
 */
export interface CompactionConditionEvaluator {
  /** True when enabled conditions match (token ratio and/or visible floor). */
  shouldRequestCompaction(
    session: AgentSession,
    evaluation: CompactionEvaluationContext,
  ): Promise<boolean>;
}

export interface CreateCompactionConditionEvaluatorDeps {
  readonly conditionsStore: CompactionConditionsStore;
  readonly tokenCounters: TokenCounterRegistry;
  readonly providerModels: ProviderModelService;
}

function triggersFromConditions(
  conditions: CompactionConditions,
  deps: CreateCompactionConditionEvaluatorDeps,
): CompactionConditionTrigger | null {
  const parts: CompactionConditionTrigger[] = [];
  if (conditions.tokenRatio != null) {
    parts.push(
      new TokenRatioConditionTrigger(
        {
          tokenRatio: conditions.tokenRatio,
          resolveContextWindow: async (evaluation) =>
            deps.providerModels.getContextWindow(
              evaluation.modelContext.applicationModelId,
            ),
          resolveTokenizerOverride: async (evaluation) =>
            deps.providerModels.getTokenCounterMode(
              evaluation.modelContext.applicationModelId,
            ),
        },
        deps.tokenCounters,
      ),
    );
  }
  if (conditions.visibleFloor != null) {
    parts.push(new VisibleFloorTrigger(conditions.visibleFloor));
  }
  if (parts.length === 0) {
    return null;
  }
  return new CompositeConditionTrigger(parts);
}

export function createCompactionConditionEvaluator(
  deps: CreateCompactionConditionEvaluatorDeps,
): CompactionConditionEvaluator {
  return {
    async shouldRequestCompaction(session, evaluation) {
      const conditions = await deps.conditionsStore.getConditions();
      if (conditions == null || !conditions.enabled) {
        return false;
      }
      const trigger = triggersFromConditions(conditions, deps);
      if (trigger == null) {
        return false;
      }
      return trigger.shouldTrigger(session, evaluation);
    },
  };
}
