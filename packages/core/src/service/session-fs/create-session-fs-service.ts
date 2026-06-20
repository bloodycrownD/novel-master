/**
 * Session FS service factory.
 *
 * @module service/session-fs/create-session-fs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { createMessageRollbackService } from "@/service/message-checkpoint/create-message-checkpoint-services.js";
import { DefaultSessionFsService } from "./impl/session-fs.service.js";
import type { SessionWorktreeSnapshotStore } from "@/service/prompt/session-worktree-snapshot.port.js";
import type { SessionFsService } from "./session-fs.port.js";

/**
 * Creates a {@link SessionFsService} for the given connection.
 * * @param conn - Open connection after {@link bootstrapNovelMaster}
 * @param worktreeSnapshot - 与 runtime orchestrator 共用的 worktree 快照 store（生产环境必传）
 */
export function createSessionFsService(
  conn: TdbcConnection,
  worktreeSnapshot?: SessionWorktreeSnapshotStore,
): SessionFsService {
  return new DefaultSessionFsService({
    messageRollback: createMessageRollbackService(conn, worktreeSnapshot),
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
