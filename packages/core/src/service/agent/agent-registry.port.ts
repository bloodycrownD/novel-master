/**
 * Agent registry service port.
 *
 * @module service/agent/agent-registry.port
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/validate-agent-definition.js";

/** Workspace agent registry (SQL-backed). */
export interface AgentRegistryService {
  listAgentIds(): Promise<readonly string[]>;
  get(agentId: string): Promise<AgentDefinition>;
  upsert(
    agentId: string,
    def: AgentDefinition,
    options?: ValidateAgentDefinitionOptions,
  ): Promise<void>;
  delete(agentId: string): Promise<void>;
}
