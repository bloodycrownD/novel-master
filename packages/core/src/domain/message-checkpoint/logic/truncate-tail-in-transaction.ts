/**
 * 共享 tail 截断事务逻辑（批量删与回滚共用）。
 *
 * @module domain/message-checkpoint/logic/truncate-tail-in-transaction
 */

import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { sweepSessionRevisions } from "./revision-gc.js";

/** tail 截断事务参数。 */
export type TruncateTailParams = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly afterSeq: number;
  readonly sweepRevisions: boolean;
};

/** {@link truncateTailInTransaction} 依赖。 */
export type TruncateTailDeps = {
  readonly messages: MessageRepository;
  readonly checkpoints: MessageCheckpointRepository;
  readonly sessions: SessionRepository;
  readonly revisions: VfsRevisionRepository;
  readonly entries: VfsEntryRepository;
};

/** 从事务连接构造 {@link TruncateTailDeps}。 */
export function truncateTailDepsFromTx(tx: TdbcConnection): TruncateTailDeps {
  return {
    messages: new SqliteMessageRepository(tx),
    checkpoints: new SqliteMessageCheckpointRepository(tx),
    sessions: new SqliteSessionRepository(tx),
    revisions: new SqliteVfsRevisionRepository(tx),
    entries: new SqliteVfsEntryRepository(tx),
  };
}

/**
 * 在已有事务内截断 tail 消息并清理 checkpoint。
 *
 * 1. 列出 seq > afterSeq 的消息 → tailIds
 * 2. deleteCheckpointsForMessages(sessionId, tailIds)
 * 3. messages.deleteAfterSeq(sessionId, afterSeq)
 * 4. 若 sweepRevisions → sweepSessionRevisions(...)
 * 5. 若 tail 非空 → sessions.setUserVfsPendingJson(sessionId, null)
 */
export async function truncateTailInTransaction(
  _tx: TdbcConnection,
  deps: TruncateTailDeps,
  params: TruncateTailParams,
): Promise<void> {
  const { projectId, sessionId, afterSeq, sweepRevisions } = params;
  const all = await deps.messages.listBySession(sessionId);
  const tailIds = all.filter((m) => m.seq > afterSeq).map((m) => m.id);

  if (tailIds.length > 0) {
    await deps.checkpoints.deleteCheckpointsForMessages(sessionId, tailIds);
  }
  await deps.messages.deleteAfterSeq(sessionId, afterSeq);

  if (sweepRevisions) {
    await sweepSessionRevisions(
      deps.revisions,
      deps.entries,
      deps.checkpoints,
      projectId,
      sessionId,
    );
  }

  if (tailIds.length > 0) {
    await deps.sessions.setUserVfsPendingJson(sessionId, null);
  }
}
