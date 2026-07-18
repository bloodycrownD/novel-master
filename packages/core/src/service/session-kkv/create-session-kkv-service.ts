/**
 * Session KKV 服务工厂。
 *
 * @module service/session-kkv/create-session-kkv-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import { DefaultSessionKkvService } from "./impl/session-kkv.service.js";
import type { SessionKkvService } from "./session-kkv.port.js";

/**
 * 创建基于 SQLite `session_kkv_entry` 的 {@link SessionKkvService}。
 *
 * @param conn - 已 {@link bootstrapNovelMaster} 的连接（可为事务连接）
 */
export function createSessionKkvService(
  conn: TdbcConnection,
): SessionKkvService {
  return new DefaultSessionKkvService(new SqliteSessionKkvRepository(conn));
}
