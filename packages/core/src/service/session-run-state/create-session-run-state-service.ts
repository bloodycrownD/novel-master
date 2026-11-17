/**
 * Session Run State 服务工厂。
 *
 * @module service/session-run-state/create-session-run-state-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteSessionRunStateRepository } from "@/domain/session-run-state/repositories/impl/sqlite-session-run-state.repository.js";
import type { SessionRunStateService } from "./session-run-state.port.js";

/**
 * 创建基于 SQLite `session_run_state` 的 {@link SessionRunStateService}。
 *
 * 端口适配器（调用方依赖注入的接缝）：`settle` 按端口契约写入 settled 行并清空
 * partial 字段，其余方法原样转发。
 *
 * @param conn - 已 {@link bootstrapNovelMaster} 的连接（可为事务连接）
 */
export function createSessionRunStateService(conn: TdbcConnection): SessionRunStateService {
  const repo = new SqliteSessionRunStateRepository(conn);
  return {
    get: repo.get.bind(repo),
    upsert: repo.upsert.bind(repo),
    settle: async (input) => {
      await repo.upsert({ ...input, status: "settled", partialText: null, partialThinking: null, pendingChildrenJson: null });
    },
    listByStatuses: repo.listByStatuses.bind(repo),
    deleteBySession: repo.deleteBySession.bind(repo),
    deleteByProject: repo.deleteByProject.bind(repo),
  };
}
