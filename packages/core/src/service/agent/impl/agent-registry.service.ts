/**
 * Default {@link AgentRegistryService} implementation.
 *
 * @module service/agent/impl/agent-registry.service
 */

import { AgentConfigError } from "@/errors/agent-config-errors.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentDefinitionRepository } from "@/domain/agent/repositories/agent-definition.port.js";
import {
  validateAgentDefinition,
  type ValidateAgentDefinitionOptions,
} from "@/domain/agent/logic/validate-agent-definition.js";
import type { CompactionPolicyStore } from "@/service/compaction/compaction-policy-store.port.js";
import type { AgentRegistryService } from "../agent-registry.port.js";

export class DefaultAgentRegistryService implements AgentRegistryService {
  constructor(
    private readonly repository: AgentDefinitionRepository,
    private readonly compactionPolicy?: CompactionPolicyStore,
  ) {}

  async listAgentIds(): Promise<readonly string[]> {
    return this.repository.listIds();
  }

  async get(agentId: string): Promise<AgentDefinition> {
    const def = await this.repository.get(agentId);
    if (def == null) {
      throw new AgentConfigError("AGENT_NOT_FOUND", `agent not found: ${agentId}`);
    }
    return def;
  }

  async upsert(
    agentId: string,
    def: AgentDefinition,
    options: ValidateAgentDefinitionOptions = {},
  ): Promise<void> {
    await validateAgentDefinition(def, options);
    const normalized: AgentDefinition = { ...def, name: agentId };
    await this.repository.upsert(agentId, normalized);
  }

  async delete(agentId: string): Promise<void> {
    if (this.compactionPolicy != null) {
      const policy = await this.compactionPolicy.getPolicy();
      const abstract = policy?.action.abstract;
      if (
        policy != null &&
        abstract?.type === "agent" &&
        abstract.agentId === agentId
      ) {
        throw new AgentConfigError(
          "AGENT_IN_USE",
          `agent is referenced by compaction policy: ${agentId}`,
        );
      }
    }
    const existing = await this.repository.get(agentId);
    if (existing == null) {
      throw new AgentConfigError("AGENT_NOT_FOUND", `agent not found: ${agentId}`);
    }
    await this.repository.delete(agentId);
  }
}
