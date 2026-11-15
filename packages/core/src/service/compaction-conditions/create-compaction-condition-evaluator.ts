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
import {
  DEFAULT_HIDE_START_DEPTH,
  type CompactionConditions,
} from "@/domain/compaction-conditions/model/compaction-conditions.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { ProviderModelService } from "@/service/provider/provider-model.port.js";
import type { CompactionConditionsStore } from "./compaction-conditions-store.port.js";

/**
 * 评估持久化的压缩条件（OR 触发器），命中时由调用方直调 `runCompaction`。
 *
 * 同时暴露当前配置的 `hideStartDepth`，供执行器读取起始深度。
 */
export interface CompactionConditionEvaluator {
  /** True when enabled conditions match (token ratio and/or visible floor). */
  shouldRequestCompaction(
    session: AgentSession,
    evaluation: CompactionEvaluationContext
  ): Promise<Result<boolean, AppError>>;
  /**
   * 当前持久化配置的 hide-message 起始深度；
   * 未配置或无文档时回落到 {@link DEFAULT_HIDE_START_DEPTH}。
   */
  getHideStartDepth(): Promise<Result<number, AppError>>;
}

export interface CreateCompactionConditionEvaluatorDeps {
  readonly conditionsStore: CompactionConditionsStore;
  readonly tokenCounters: TokenCounterRegistry;
  readonly providerModels: ProviderModelService;
}

function triggersFromConditions(
  conditions: CompactionConditions,
  deps: CreateCompactionConditionEvaluatorDeps
): CompactionConditionTrigger | null {
  const parts: CompactionConditionTrigger[] = [];
  if (conditions.tokenRatio != null) {
    parts.push(
      new TokenRatioConditionTrigger(
        {
          tokenRatio: conditions.tokenRatio,
          resolveContextWindow: async (evaluation) =>
            deps.providerModels.getContextWindow(
              evaluation.modelContext.savedModelId
            ),
          resolveTokenizerOverride: async (evaluation) =>
            deps.providerModels.getTokenCounterMode(
              evaluation.modelContext.savedModelId
            ),
        },
        deps.tokenCounters
      )
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
  deps: CreateCompactionConditionEvaluatorDeps
): CompactionConditionEvaluator {
  return {
    async shouldRequestCompaction(session, evaluation) {
      const conditions = await deps.conditionsStore.getConditions();
      if (!conditions.ok) return Result.err(conditions.error);
      if (conditions.value == null || !conditions.value.enabled) {
        return Result.ok(false);
      }
      const trigger = triggersFromConditions(conditions.value, deps);
      if (trigger == null) {
        return Result.ok(false);
      }
      return Result.ok(await trigger.shouldTrigger(session, evaluation));
    },
    async getHideStartDepth() {
      const conditions = await deps.conditionsStore.getConditions();
      if (!conditions.ok) return Result.err(conditions.error);
      return Result.ok(conditions.value?.hideStartDepth ?? DEFAULT_HIDE_START_DEPTH);
    },
  };
}
