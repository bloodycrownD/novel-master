/**
 * Session FS service factory.
 *
 * @module service/session-fs/create-session-fs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteSessionSnapshotRepository } from "@/domain/session-fs/repositories/impl/sqlite-snapshot.repository.js";
import { SqliteSessionExecuteRepository } from "@/domain/session-fs/repositories/impl/sqlite-execute.repository.js";
import { createMessageRollbackService } from "@/service/message-checkpoint/create-message-checkpoint-services.js";
import { DefaultSessionFsService } from "./impl/session-fs.service.js";
import type { SessionFsService } from "./session-fs.port.js";

/**
 * Creates a {@link SessionFsService} for the given connection.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createSessionFsService(conn: TdbcConnection): SessionFsService {
  return new DefaultSessionFsService({
    conn,
    snapshots: new SqliteSessionSnapshotRepository(conn),
    execute: new SqliteSessionExecuteRepository(conn),
    messages: new SqliteMessageRepository(conn),
    messageRollback: createMessageRollbackService(conn),
  });
}

/** Deletes all session-fs rows for a session (used on session delete). */
export async function deleteSessionFsData(
  conn: TdbcConnection,
  sessionId: string,
): Promise<void> {
  const snapshots = new SqliteSessionSnapshotRepository(conn);
  const execute = new SqliteSessionExecuteRepository(conn);
  await snapshots.deleteBySession(sessionId);
  await execute.deleteBySession(sessionId);
}
