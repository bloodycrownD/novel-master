/**
 * Session Run State 服务工厂。
 *
 * @module service/session-run-state/create-session-run-state-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionRunStateRepository } from "@/domain/session-run-state/repositories/impl/sqlite-session-run-state.repository.js";
import { DefaultSessionRunStateService } from "./impl/session-run-state.service.js";
import type { SessionRunStateService } from "./session-run-state.port.js";

/**
 * 创建基于 SQLite `session_run_state` 的 {@link SessionRunStateService}。
 *
 * @param conn - 已 {@link bootstrapNovelMaster} 的连接（可为事务连接）
 */
export function createSessionRunStateService(
  conn: TdbcConnection
): SessionRunStateService {
  return new DefaultSessionRunStateService(
    new SqliteSessionRunStateRepository(conn)
  );
}
