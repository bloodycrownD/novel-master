/**
 * Agent definition repository port.
 *
 * @module domain/agent/repositories/agent-definition.port
 */

import type { AgentDefinition } from "../model/agent-definition.js";

/** Persistence for workspace agent definitions. */
export interface AgentDefinitionRepository {
  listIds(): Promise<readonly string[]>;
  get(agentId: string): Promise<AgentDefinition | null>;
  upsert(agentId: string, def: AgentDefinition): Promise<void>;
  delete(agentId: string): Promise<void>;
}
