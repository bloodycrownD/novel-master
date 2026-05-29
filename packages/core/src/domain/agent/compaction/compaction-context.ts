/**
 * Inputs for compaction trigger evaluation and action execution.
 *
 * @module domain/agent/compaction/compaction-context
 */

import type { AgentDefinition } from "@/domain/agent/agent-definition.js";
import type { AgentSession } from "@/domain/agent/agent-session.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";

/** Runtime context passed to compaction action (no file I/O). */
export interface CompactionContext {
  readonly session: AgentSession;
  readonly definition: AgentDefinition;
  readonly modelRequests: ModelRequestService;
  /** Worktree display for text abstract macro expansion (excludes dot.abstract). */
  readonly worktreeDisplay: string;
  readonly now?: Date;
}
