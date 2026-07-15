/**
 * 共享 tail 截断事务逻辑（批量删与回滚共用）。
 *
 * @module domain/message-checkpoint/logic/truncate-tail-in-transaction
 */

import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import {
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
  USER_VFS_PENDING_QUEUE_KEY,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvRepository } from "@/domain/session-kkv/repositories/session-kkv.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
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
  /** pending 队列：session kkv（tail 非空时清空）。 */
  readonly sessionKkv: SessionKkvRepository;
  readonly revisions: VfsRevisionRepository;
  readonly entries: VfsEntryRepository;
};

/**
 * 在已有事务内截断 tail 消息并清理 checkpoint。
 *
 * 1. 列出 seq > afterSeq 的消息 → tailIds
 * 2. deleteCheckpointsForMessages(sessionId, tailIds)
 * 3. messages.deleteAfterSeq(sessionId, afterSeq)
 * 4. 若 sweepRevisions → sweepSessionRevisions(...)
 * 5. 若 tail 非空 → 清空 session kkv `user_vfs_pending` 队列键
 */
export async function truncateTailInTransaction(
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
    await deps.sessionKkv.delete(
      sessionId,
      SESSION_KKV_DOMAIN_USER_VFS_PENDING,
      USER_VFS_PENDING_QUEUE_KEY,
    );
  }
}
