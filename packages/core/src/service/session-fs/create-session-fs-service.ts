/**
 * Session FS service factory.
 *
 * @module service/session-fs/create-session-fs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
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
    messageRollback: createMessageRollbackService(conn),
  });
}

/** Deletes message checkpoint rows for a session (used on session delete / template pull). */
export async function deleteSessionFsData(
  conn: TdbcConnection,
  sessionId: string,
): Promise<void> {
  const checkpoints = new SqliteMessageCheckpointRepository(conn);
  await checkpoints.deleteCheckpointsForSession(sessionId);
}
