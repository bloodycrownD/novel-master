/**
 * Session KKV 服务工厂。
 *
 * @module service/session-kkv/create-session-kkv-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import type { SessionKkvService } from "./session-kkv.port.js";

/** Session KKV service 工厂集合。 */
export const SessionKkvServiceFactory = {
  /**
   * 创建基于 SQLite `session_kkv_entry` 的 {@link SessionKkvService}。
   *
   * 端口适配器（调用方依赖注入的接缝）：仓储条目只在 `get` 处解包为
   * `string | null`，`delete` 按端口契约丢弃 bool 结果，其余方法原样转发。
   *
   * @param conn - 已 {@link NovelMasterBootstrap.bootstrap} 的连接（可为事务连接）
   */
  create(conn: TdbcConnection): SessionKkvService {
    const repo = new SqliteSessionKkvRepository(conn);
    return {
      get: async (sessionId, domain, key) => (await repo.get(sessionId, domain, key))?.value ?? null,
      getMany: repo.getMany.bind(repo),
      set: repo.set.bind(repo),
      delete: async (sessionId, domain, key) => {
        await repo.delete(sessionId, domain, key);
      },
      clearDomain: repo.clearDomain.bind(repo),
      clearSession: repo.clearSession.bind(repo),
      listKeys: repo.listKeys.bind(repo),
    };
  },
} as const;
