/**
 * Resolves compaction summary agents from SQL agent registry.
 *
 * @module service/compaction/impl/db-compaction-agent-resolver
 */

import { CompactionPolicyError } from "@/errors/compaction-policy-errors.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import type { CompactionAgentResolver } from "../compaction-agent-resolver.port.js";

/**
 * Loads agent definitions from {@link AgentRegistryService}.
 */
export function createDbCompactionAgentResolver(
  registry: AgentRegistryService,
): CompactionAgentResolver {
  return {
    async resolve(agentId: string): Promise<AgentDefinition> {
      try {
        return await registry.get(agentId);
      } catch (error) {
        if (
          error instanceof AgentConfigError &&
          error.code === "AGENT_NOT_FOUND"
        ) {
          throw new CompactionPolicyError(
            "AGENT_NOT_FOUND",
            `agent not found: ${agentId}`,
            { agentId },
          );
        }
        throw error;
      }
    },
  };
}
