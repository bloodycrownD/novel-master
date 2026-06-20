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
import type { PersistentState } from "@/service/persistent-state/persistent-state.port.js";
import type { AgentRegistryService } from "../agent-registry.port.js";

export interface DefaultAgentRegistryServiceDeps {
  readonly repository: AgentDefinitionRepository;
  /** 注入时，删除当前 Agent 会清空工作区指针。 */
  readonly state?: PersistentState;
}

export class DefaultAgentRegistryService implements AgentRegistryService {
  constructor(private readonly deps: DefaultAgentRegistryServiceDeps) {}

  async listAgentIds(): Promise<readonly string[]> {
    return this.deps.repository.listIds();
  }

  async getRawWire(agentId: string): Promise<unknown | null> {
    return this.deps.repository.getRawWire(agentId);
  }

  async get(agentId: string): Promise<AgentDefinition> {
    const def = await this.deps.repository.get(agentId);
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
    await this.assertUniqueDisplayName(agentId, trimmedName);

    const normalized: AgentDefinition = { ...def, name: trimmedName };
    await this.deps.repository.upsert(agentId, normalized);
  }

  private async assertUniqueDisplayName(
    agentId: string,
    name: string,
  ): Promise<void> {
    const ids = await this.deps.repository.listIds();
    for (const otherId of ids) {
      if (otherId === agentId) {
        continue;
      }
      let otherName: string;
      try {
        const otherDef = await this.deps.repository.get(otherId);
        otherName = otherDef == null ? otherId.trim() : otherDef.name.trim();
      } catch {
        otherName = otherId.trim();
      }
      if (otherName.length > 0 && otherName === name) {
        throw new AgentConfigError("DUPLICATE_NAME", "Agent 名称已存在");
      }
    }
  }

  async delete(agentId: string): Promise<void> {
    if (!(await this.deps.repository.exists(agentId))) {
      throw new AgentConfigError("AGENT_NOT_FOUND", `agent not found: ${agentId}`);
    }
    await this.deps.repository.delete(agentId);
    if (this.deps.state) {
      const current = await this.deps.state.getCurrentAgentId();
      if (current === agentId) {
        await this.deps.state.resetCurrentAgentId();
      }
    }
  }
}