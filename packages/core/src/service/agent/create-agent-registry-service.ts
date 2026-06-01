/**
 * Factory for {@link AgentRegistryService}.
 *
 * @module service/agent/create-agent-registry-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteAgentDefinitionRepository } from "@/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import { DefaultAgentRegistryService } from "./impl/agent-registry.service.js";
import type { AgentRegistryService } from "./agent-registry.port.js";

/** Creates SQL-backed agent registry service. */
export function createAgentRegistryService(
  conn: TdbcConnection,
): AgentRegistryService {
  const repository = new SqliteAgentDefinitionRepository(conn);
  return new DefaultAgentRegistryService(repository);
}
