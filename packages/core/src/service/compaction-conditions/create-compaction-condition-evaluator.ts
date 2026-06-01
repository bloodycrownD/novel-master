/**
 * Factory for compaction condition evaluation (OR triggers).
 *
 * @module service/compaction-conditions/create-compaction-condition-evaluator
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import { CompositeConditionTrigger } from "@/domain/compaction-conditions/triggers/composite-trigger.js";
import { VisibleFloorTrigger } from "@/domain/compaction-conditions/triggers/visible-floor.trigger.js";
import { TokenThresholdConditionTrigger } from "@/domain/compaction-conditions/triggers/token-threshold.trigger.js";
import type { CompactionConditionTrigger } from "@/domain/compaction-conditions/ports/compaction-condition-trigger.port.js";
import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import { parseApplicationModelId } from "@/domain/provider/logic/application-model-id.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import {
  mergeSamplingWithDefaults,
  maxOutputTokensFromSampling,
} from "@/domain/provider/model/protocol-sampling-defaults.js";
import type { CompactionConditionsStore } from "./compaction-conditions-store.port.js";

export interface CompactionConditionEvaluator {
  shouldRequestCompaction(
    session: AgentSession,
    modelContext: {
      readonly workspaceModelId: string;
      readonly applicationModelId: string;
    },
  ): Promise<boolean>;
}

export interface CreateCompactionConditionEvaluatorDeps {
  readonly conditionsStore: CompactionConditionsStore;
  readonly tokenCounters: TokenCounterRegistry;
  readonly providers?: ProviderRepository;
}

function triggersFromConditions(
  conditions: CompactionConditions,
  deps: CreateCompactionConditionEvaluatorDeps,
): CompactionConditionTrigger | null {
  const parts: CompactionConditionTrigger[] = [];
  if (conditions.tokenThreshold != null) {
    parts.push(
      new TokenThresholdConditionTrigger(
        {
          tokenThreshold: conditions.tokenThreshold,
          tokenRatio: conditions.tokenRatio,
          resolveMaxContextTokens: async (ctx) =>
            resolveMaxContextTokens(ctx.applicationModelId, deps.providers),
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

async function resolveMaxContextTokens(
  applicationModelId: string,
  providers?: ProviderRepository,
): Promise<number> {
  try {
    const { providerId } = parseApplicationModelId(applicationModelId);
    const protocol =
      providers != null
        ? (await providers.findById(providerId))?.protocol ?? "openai"
        : "openai";
    const defaults = mergeSamplingWithDefaults(protocol, undefined);
    const cap = maxOutputTokensFromSampling(defaults);
    return cap ?? 128_000;
  } catch {
    return 128_000;
  }
}

export function createCompactionConditionEvaluator(
  deps: CreateCompactionConditionEvaluatorDeps,
): CompactionConditionEvaluator {
  return {
    async shouldRequestCompaction(session, modelContext) {
      const conditions = await deps.conditionsStore.getConditions();
      if (conditions == null || !conditions.enabled) {
        return false;
      }
      const trigger = triggersFromConditions(conditions, deps);
      if (trigger == null) {
        return false;
      }
      return trigger.shouldTrigger(session, modelContext);
    },
  };
}
