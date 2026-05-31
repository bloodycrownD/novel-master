/**
 * Compaction pipeline port (trigger OR â†?action).
 *
 * @module service/compaction/compaction-pipeline.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { CompactionModelContext } from "@/domain/compaction/model/compaction-model-context.js";
import type { PromptMacroContext } from "../prompt/render-prompt.js";

/** Evaluates triggers and optionally runs compaction action before each model step. */
export interface CompactionPipeline {
  /**
   * Runs compaction when triggers fire.
   * @returns new abstract text, or `undefined` when abstract should be unchanged.
   */
  maybeCompact(
    session: AgentSession,
    macroContext: PromptMacroContext,
    modelContext: CompactionModelContext,
  ): Promise<string | undefined>;
}
