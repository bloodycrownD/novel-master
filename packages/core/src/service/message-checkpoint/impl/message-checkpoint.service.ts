/**
 * Default {@link MessageCheckpointService} implementation.
 *
 * @module service/message-checkpoint/impl/message-checkpoint.service
 */

import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { MessageCheckpointService } from "../message-checkpoint.port.js";

/** Dependencies for {@link DefaultMessageCheckpointService}. */
export interface MessageCheckpointServiceDeps {
  readonly conn: TdbcConnection;
  readonly entries: VfsEntryRepository;
}

/**
 * Scans session files and writes a checkpoint tree (files only, no empty dirs).
 */
export class DefaultMessageCheckpointService implements MessageCheckpointService {
  constructor(private readonly deps: MessageCheckpointServiceDeps) {}

  /**
   * @remarks listSessionFileHeads 移入事务内执行，持锁扫描避免并发 capture 捕获陈旧 head。
   */
  async capture(
    sessionId: string,
    projectId: string,
    messageId: string,
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      // listSessionFileHeads 在事务内调：用绑定 tx 的 entry repo 持锁扫描，
      // 避免并发 capture 读到未提交的 head（V8）。
      const txEntries = new SqliteVfsEntryRepository(tx);
      const files = await listSessionFileHeads(
        txEntries,
        projectId,
        sessionId,
      );
      if (files.length === 0) {
        return;
      }

      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      await checkpoints.insertCheckpoint({
        sessionId,
        messageId,
        createdAtMs: Date.now(),
        files: files.map((f) => ({
          entryId: f.entryId,
          revisionVersion: f.headVersion,
        })),
      });
    });
  }
}
