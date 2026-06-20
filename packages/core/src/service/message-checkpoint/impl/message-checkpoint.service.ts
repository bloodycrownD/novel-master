/**
 * Default {@link MessageCheckpointService} implementation.
 *
 * @module service/message-checkpoint/impl/message-checkpoint.service
 */

import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
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
   * @remarks listSessionFileHeads 在 insert 事务外执行；单写 desktop 可接受，并发 session 写可能捕获陈旧 head。
   */
  async capture(
    sessionId: string,
    projectId: string,
    messageId: string,
  ): Promise<void> {
    const files = await listSessionFileHeads(
      this.deps.entries,
      projectId,
      sessionId,
    );
    if (files.length === 0) {
      return;
    }

    await this.deps.conn.transaction(async (tx) => {
      const checkpoints = new SqliteMessageCheckpointRepository(tx);
      // Boundary: capture runs in one transaction so tree index stays consistent.
      await checkpoints.insertCheckpoint({
        sessionId,
        messageId,
        createdAtMs: Date.now(),
        files: files.map((f) => ({
          logicalPath: f.logicalPath,
          revisionVersion: f.headVersion,
        })),
      });
    });
  }
}
