/**
 * Creates a {@link SessionFsService} for the given connection.
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
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
