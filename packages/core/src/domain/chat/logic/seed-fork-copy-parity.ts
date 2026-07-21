/**
 * fork / session.copy 共用：种带 content 的 revision、复制 workplace 规则、挂同树 checkpoint。
 *
 * @module domain/chat/logic/seed-fork-copy-parity
 */

import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { toPhysicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

/** {@link seedForkCopyParity} 入参。 */
export interface SeedForkCopyParityInput {
  readonly projectId: string;
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly newMessages: ReadonlyArray<{ readonly id: string }>;
}

/**
 * 在已开事务内、VFS 与消息写入目标会话之后调用。
 *
 * 内部顺序钉死：list heads → findByPath 取 content → revisions.append →
 * session→session copyScope → 对每条新消息 insertCheckpoint（同一活树）。
 *
 * @remarks 禁止嵌套调用 MessageCheckpointService.capture；禁止指望 backfill 播种。
 */
export async function seedForkCopyParity(
  tx: TdbcConnection,
  input: SeedForkCopyParityInput,
): Promise<void> {
  const entries = new SqliteVfsEntryRepository(tx);
  const revisions = new SqliteVfsRevisionRepository(tx);
  const workplace = new SqliteWorkplaceRepository(tx);
  const checkpoints = new SqliteMessageCheckpointRepository(tx);

  const { projectId, sourceSessionId, targetSessionId, newMessages } = input;
  const targetScope = {
    kind: "session" as const,
    projectId,
    sessionId: targetSessionId,
  };

  const heads = await listSessionFileHeads(
    entries,
    projectId,
    targetSessionId,
  );

  for (const head of heads) {
    const physical = toPhysicalPath(targetScope, head.logicalPath);
    const entry = await entries.findByPath(physical);
    if (entry == null || entry.entryKind !== "file") {
      await revisions.append({
        path: physical,
        version: head.headVersion,
        content: null,
        status: "deleted",
        mtimeMs: Date.now(),
        storageKind: "inline",
      });
      continue;
    }
    await revisions.append({
      path: physical,
      version: head.headVersion,
      content: entry.content,
      status: "active",
      mtimeMs: entry.mtimeMs,
      storageKind: entry.storageKind,
    });
  }

  await workplace.copyScope(
    workplaceScopeKey({
      kind: "session",
      projectId,
      sessionId: sourceSessionId,
    }),
    workplaceScopeKey({
      kind: "session",
      projectId,
      sessionId: targetSessionId,
    }),
    (p) => normalizePath(p),
  );

  if (heads.length === 0 || newMessages.length === 0) {
    return;
  }

  const files = heads.map((h) => ({
    logicalPath: h.logicalPath,
    revisionVersion: h.headVersion,
  }));
  const createdAtMs = Date.now();
  for (const msg of newMessages) {
    await checkpoints.insertCheckpoint({
      sessionId: targetSessionId,
      messageId: msg.id,
      createdAtMs,
      files,
    });
  }
}
