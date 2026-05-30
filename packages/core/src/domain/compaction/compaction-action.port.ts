/**
 * Compaction action port (hide + produce abstract).
 *
 * @module domain/compaction/compaction-action.port
 */

import type { CompactionContext } from "./compaction-context.js";

/** Result of a compaction action run. */
export interface CompactionActionResult {
  readonly abstract: string;
}

/** Hides older messages and produces abstract text for dot + summary message. */
export interface CompactionAction {
  execute(ctx: CompactionContext): Promise<CompactionActionResult>;
}
