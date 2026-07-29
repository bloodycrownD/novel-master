/**
 * Session FS 服务工厂。
 *
 * @module service/session-fs/create-session-fs-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { decrementLiveRefsUnderScope } from "@/domain/vfs/logic/revision-ref-count.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { createMessageRollbackService } from "@/service/message-checkpoint/create-message-checkpoint-services.js";
import { DefaultSessionFsService } from "./impl/session-fs.service.js";
import type { SessionFsService } from "./session-fs.port.js";

/** 为给定连接创建 {@link SessionFsService}。 */
export function createSessionFsService(conn: TdbcConnection): SessionFsService {
  return new DefaultSessionFsService({
    messageRollback: createMessageRollbackService(conn),
  });
}

/**
 * 删除会话 checkpoint / live ref / revision 打扫（会话删除 / 模板拉取时使用）。
 *
 * 顺序：−checkpoint ref → −live ref → 删 checkpoint 行 → revision 前缀打扫。
 * blob gc 由调用方在事务提交后调度 {@link runDeferredBlobGc}。
 */
export async function deleteSessionFsData(
  conn: TdbcConnection,
  sessionId: string,
  projectId: string,
): Promise<void> {
  const checkpoints = new SqliteMessageCheckpointRepository(conn);
  const revisions = new SqliteVfsRevisionRepository(conn);
  const entries = new SqliteVfsEntryRepository(conn);
  const sessionScope = {
    kind: "session" as const,
    projectId,
    sessionId,
  };
  const sk = scopeKey(sessionScope);

  await checkpoints.deleteCheckpointsForSession(sessionId);
  await decrementLiveRefsUnderScope(revisions, entries, sk, "/");
  await sweepSessionRevisions(
    revisions,
    entries,
    checkpoints,
    projectId,
    sessionId,
    conn,
  );
}

/** 事务提交后调度全库 blob gc（项目/会话删除批量路径用）。 */
export { runDeferredBlobGc };
