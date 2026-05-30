/**
 * Compaction pipeline port (trigger OR → action).
 *
 * @module service/compaction/compaction-pipeline.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { CompactionModelContext } from "@/domain/compaction/compaction-model-context.js";

/** Evaluates triggers and optionally runs compaction action before each model step. */
export interface CompactionPipeline {
  /**
   * Runs compaction when triggers fire.
   * @returns new abstract text, or `undefined` when abstract should be unchanged.
   */
  maybeCompact(
    session: AgentSession,
    worktreeDisplay: string,
    modelContext: CompactionModelContext,
  ): Promise<string | undefined>;
}
