/**
 * Session FS 服务工厂。
 *
 * @module service/session-fs/create-session-fs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { createMessageRollbackService } from "@/service/message-checkpoint/create-message-checkpoint-services.js";
import { DefaultSessionFsService } from "./impl/session-fs.service.js";
import type { SessionFsService } from "./session-fs.port.js";

/** 为给定连接创建 {@link SessionFsService}。 */
export function createSessionFsService(conn: TdbcConnection): SessionFsService {
  return new DefaultSessionFsService({
    messageRollback: createMessageRollbackService(conn),
  });
}

/** 删除会话的消息 checkpoint 行（会话删除 / 模板拉取时使用）。 */
export async function deleteSessionFsData(
  conn: TdbcConnection,
  sessionId: string,
): Promise<void> {
  const checkpoints = new SqliteMessageCheckpointRepository(conn);
  await checkpoints.deleteCheckpointsForSession(sessionId);
}
