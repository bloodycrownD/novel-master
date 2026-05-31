/**
 * Resolves summary agents by registry id for compaction actions.
 *
 * @module domain/compaction/ports/compaction-agent-resolver.port
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/** Loads an agent definition referenced by `abstract.type: agent` agentId. */
export interface CompactionAgentResolver {
  resolve(agentId: string): Promise<AgentDefinition>;
}
