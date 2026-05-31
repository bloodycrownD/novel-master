/**
 * Inputs for compaction trigger evaluation and action execution.
 *
 * @module domain/compaction/compaction-context
 */

import type { CompactionPolicy } from "./compaction-policy.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { CompactionAgentResolver } from "@/domain/compaction/ports/compaction-agent-resolver.port.js";
import type { CompactionModelRequest } from "@/domain/compaction/ports/compaction-model-request.port.js";
import type { CompactionModelContext } from "./compaction-model-context.js";

/** Runtime context passed to compaction action (no file I/O). */
export interface CompactionContext {
  readonly session: AgentSession;
  readonly policy: CompactionPolicy;
  readonly modelRequests: CompactionModelRequest;
  readonly resolveAgent: CompactionAgentResolver;
  /** Dialogue model + optional CLI flag for summary id resolution. */
  readonly modelContext: CompactionModelContext;
  /** Worktree display for text abstract macro expansion (excludes dot.abstract). */
  readonly worktreeDisplay: string;
  /** ASCII file tree for `{{.filetree}}` in compaction abstract templates. */
  readonly filetreeDisplay: string;
  readonly now?: Date;
}
