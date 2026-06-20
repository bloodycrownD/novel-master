/**
 * Factory for {@link AgentRegistryService}.
 *
 * @module service/agent/create-agent-registry-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteAgentDefinitionRepository } from "@/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import type { PersistentState } from "@/service/persistent-state/persistent-state.port.js";
import { DefaultAgentRegistryService } from "./impl/agent-registry.service.js";
import type { AgentRegistryService } from "./agent-registry.port.js";

/**
 * 创建 SQL 后端的 Agent 注册表服务。
 *
 * @param conn - {@link bootstrapNovelMaster} 之后已打开的连接
 * @param state - 可选；注入时 {@link AgentRegistryService.delete} 会重置当前指针
 */
export function createAgentRegistryService(
  conn: TdbcConnection,
  state?: PersistentState,
): AgentRegistryService {
  const repository = new SqliteAgentDefinitionRepository(conn);
  return new DefaultAgentRegistryService({ repository, state });
}