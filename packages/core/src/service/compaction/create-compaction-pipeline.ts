/**
 * Factory for default compaction pipeline.
 *
 * @module service/compaction/create-compaction-pipeline
 */

import type { CompactionPolicy } from "@/domain/compaction/compaction-policy.js";
import { DefaultCompactionAction } from "@/domain/agent/compaction/action/default-compaction-action.js";
import { CompositeTrigger } from "@/domain/agent/compaction/triggers/composite-trigger.js";
import { FloorThresholdTrigger } from "@/domain/agent/compaction/triggers/floor-threshold.trigger.js";
import { TokenThresholdTrigger } from "@/domain/agent/compaction/triggers/token-threshold.trigger.js";
import type { CompactionTrigger } from "@/domain/agent/compaction/compaction-trigger.port.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { CompactionAgentResolver } from "./compaction-agent-resolver.port.js";
import type { CompactionPolicyStore } from "./compaction-policy-store.port.js";
import type { CompactionPipeline } from "./compaction-pipeline.port.js";

export interface CreateCompactionPipelineDeps {
  readonly modelRequests: ModelRequestService;
  readonly policyStore: CompactionPolicyStore;
  readonly resolveAgent: CompactionAgentResolver;
}

function triggersFromPolicy(policy: CompactionPolicy): CompactionTrigger | null {
  const trigger = policy.trigger;
  const parts: CompactionTrigger[] = [];
  if (trigger.tokenThreshold != null) {
    parts.push(new TokenThresholdTrigger(trigger.tokenThreshold));
  }
  if (trigger.floorThreshold != null) {
    parts.push(new FloorThresholdTrigger(trigger.floorThreshold));
  }
  if (parts.length === 0) {
    return null;
  }
  return new CompositeTrigger(parts);
}

/**
 * Creates a pipeline that reads global policy, OR-combines triggers, then runs action.
 */
export function createCompactionPipeline(
  deps: CreateCompactionPipelineDeps,
): CompactionPipeline {
  const action = new DefaultCompactionAction();

  return {
    async maybeCompact(session, worktreeDisplay) {
      const policy = await deps.policyStore.getPolicy();
      if (policy == null || !policy.enabled) {
        return undefined;
      }

      const trigger = triggersFromPolicy(policy);
      if (trigger == null) {
        return undefined;
      }

      const shouldRun = await trigger.shouldCompact(session);
      if (!shouldRun) {
        return undefined;
      }

      const result = await action.execute({
        session,
        policy,
        modelRequests: deps.modelRequests,
        resolveAgent: deps.resolveAgent,
        worktreeDisplay,
      });
      return result.abstract;
    },
  };
}

/** No-op pipeline for tests without compaction config. */
export function createNoOpCompactionPipeline(): CompactionPipeline {
  return {
    async maybeCompact(): Promise<string | undefined> {
      return undefined;
    },
  };
}
