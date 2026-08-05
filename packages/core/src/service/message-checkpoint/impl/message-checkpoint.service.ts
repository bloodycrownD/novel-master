/**
 * Default {@link MessageCheckpointService} implementation.
 *
 * @module service/message-checkpoint/impl/message-checkpoint.service
 */

import { backfillBaselineCheckpoints } from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
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

  /**
   * @remarks backfillBaselineCheckpoints 移入事务内执行：复用 capture 同款锁语义，
   * 避免并发 backfill 读到未提交的 head；与导入路径同一份纯逻辑。
   */
  async backfillMissingBaselines(
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      const txEntries = new SqliteVfsEntryRepository(tx);
      const txMessages = new SqliteMessageRepository(tx);
      const txCheckpoints = new SqliteMessageCheckpointRepository(tx);
      await backfillBaselineCheckpoints(
        txEntries,
        txMessages,
        txCheckpoints,
        projectId,
        sessionId,
      );
    });
  }
}
