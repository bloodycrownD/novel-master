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
  /** 仅检查行是否存在，不解码 prompts_json。 */
  exists(agentId: string): Promise<boolean>;
  upsert(agentId: string, def: AgentDefinition): Promise<void>;
  delete(agentId: string): Promise<void>;
}
