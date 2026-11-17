/**
 * chat 族仓储装配（conn 或事务 tx 均可）。
 *
 * project / session service 的事务块共用这组 domain 仓储构造；`revisions`
 * 只有 project.copy / project.delete 的 VFS 清理链消费，由 project service
 * 在基础四仓储之上自行追加，session 侧不构造无用实例。
 *
 * @module service/chat/chat-repo-wiring
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";

/** 装配 chat 基础四仓储（projects / sessions / messages / vfs）；conn 或事务 tx 均可。 */
export function createChatRepoDeps(conn: TdbcConnection) {
  return {
    projects: new SqliteProjectRepository(conn),
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}
