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
import type { AgentRegistryService } from "../agent-registry.port.js";

export class DefaultAgentRegistryService implements AgentRegistryService {
  constructor(private readonly repository: AgentDefinitionRepository) {}

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
    const trimmedName = def.name.trim();
    if (trimmedName.length === 0) {
      throw new AgentConfigError(
        "INVALID_SCHEMA",
        "agent name must not be empty",
      );
    }
    const normalized: AgentDefinition = { ...def, name: trimmedName };
    await this.repository.upsert(agentId, normalized);
  }

  async delete(agentId: string): Promise<void> {
    if (!(await this.repository.exists(agentId))) {
      throw new AgentConfigError("AGENT_NOT_FOUND", `agent not found: ${agentId}`);
    }
    await this.repository.delete(agentId);
  }
}
