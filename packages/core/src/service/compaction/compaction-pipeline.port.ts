/**
 * Compaction pipeline port (trigger OR → action).
 *
 * @module service/compaction/compaction-pipeline.port
 */

import type { AgentDefinition } from "@/domain/agent/agent-definition.js";
import type { AgentSession } from "@/domain/agent/agent-session.port.js";

/** Evaluates triggers and optionally runs compaction action before each model step. */
export interface CompactionPipeline {
  /**
   * Runs compaction when triggers fire.
   * @returns new abstract text, or `undefined` when abstract should be unchanged.
   */
  maybeCompact(
    session: AgentSession,
    definition: AgentDefinition,
    worktreeDisplay: string,
  ): Promise<string | undefined>;
}
