/**
 * Resolves summary agents by registry id for compaction actions.
 *
 * @module service/compaction/compaction-agent-resolver.port
 */

import type { AgentDefinition } from "@/domain/agent/agent-definition.js";

/** Loads an agent definition referenced by `abstract.type: agent` agentId. */
export interface CompactionAgentResolver {
  resolve(agentId: string): Promise<AgentDefinition>;
}
