/**
 * Factory for {@link AgentRegistryService}.
 *
 * @module service/agent/create-agent-registry-service
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqliteAgentDefinitionRepository } from "@/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import type { CompactionPolicyStore } from "@/service/compaction/compaction-policy-store.port.js";
import { DefaultAgentRegistryService } from "./impl/agent-registry.service.js";
import type { AgentRegistryService } from "./agent-registry.port.js";

export interface CreateAgentRegistryServiceOptions {
  readonly compactionPolicy?: CompactionPolicyStore;
}

/**
 * Creates SQL-backed agent registry service.
 */
export function createAgentRegistryService(
  conn: TdbcConnection,
  options: CreateAgentRegistryServiceOptions = {},
): AgentRegistryService {
  const repository = new SqliteAgentDefinitionRepository(conn);
  return new DefaultAgentRegistryService(repository, options.compactionPolicy);
}
