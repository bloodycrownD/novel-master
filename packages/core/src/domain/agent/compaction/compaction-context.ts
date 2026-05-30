/**
 * Inputs for compaction trigger evaluation and action execution.
 *
 * @module domain/agent/compaction/compaction-context
 */

import type { CompactionPolicy } from "@/domain/compaction/compaction-policy.js";
import type { AgentSession } from "@/domain/agent/agent-session.port.js";
import type { CompactionAgentResolver } from "@/service/compaction/compaction-agent-resolver.port.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";

/** Runtime context passed to compaction action (no file I/O). */
export interface CompactionContext {
  readonly session: AgentSession;
  readonly policy: CompactionPolicy;
  readonly modelRequests: ModelRequestService;
  readonly resolveAgent: CompactionAgentResolver;
  /** Worktree display for text abstract macro expansion (excludes dot.abstract). */
  readonly worktreeDisplay: string;
  readonly now?: Date;
}
