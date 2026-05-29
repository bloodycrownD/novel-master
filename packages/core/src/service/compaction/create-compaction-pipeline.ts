/**
 * Factory for default compaction pipeline.
 *
 * @module service/compaction/create-compaction-pipeline
 */

import type { AgentDefinition } from "@/domain/agent/agent-definition.js";
import { DefaultCompactionAction } from "@/domain/agent/compaction/action/default-compaction-action.js";
import { CompositeTrigger } from "@/domain/agent/compaction/triggers/composite-trigger.js";
import { FloorThresholdTrigger } from "@/domain/agent/compaction/triggers/floor-threshold.trigger.js";
import { TokenThresholdTrigger } from "@/domain/agent/compaction/triggers/token-threshold.trigger.js";
import type { CompactionTrigger } from "@/domain/agent/compaction/compaction-trigger.port.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { CompactionPipeline } from "./compaction-pipeline.port.js";

export interface CreateCompactionPipelineDeps {
  readonly modelRequests: ModelRequestService;
}

function triggersFromDefinition(def: AgentDefinition): CompactionTrigger | null {
  const trigger = def.compact?.trigger;
  if (trigger == null) {
    return null;
  }
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
 * Creates a pipeline that OR-combines triggers then runs the default action.
 */
export function createCompactionPipeline(
  deps: CreateCompactionPipelineDeps,
): CompactionPipeline {
  const action = new DefaultCompactionAction();

  return {
    async maybeCompact(session, definition, worktreeDisplay) {
      const trigger = triggersFromDefinition(definition);
      if (trigger == null || definition.compact?.action == null) {
        return undefined;
      }

      const shouldRun = await trigger.shouldCompact(session);
      if (!shouldRun) {
        return undefined;
      }

      const result = await action.execute({
        session,
        definition,
        modelRequests: deps.modelRequests,
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
