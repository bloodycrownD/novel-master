/**
 * Context compaction port.
 *
 * @module service/compaction/compaction.port
 */

import type { AgentSession } from "@/domain/agent/agent-session.port.js";

/** Compacts session history when token estimate exceeds threshold. */
export interface CompactionService {
  /**
   * Hides older messages and appends a summary user message when over threshold.
   * Called before each model round-trip.
   */
  maybeCompact(
    session: AgentSession,
    applicationModelId: string,
  ): Promise<void>;
}
