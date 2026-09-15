/**
 * Default {@link MessageCheckpointService} implementation.
 *
 * @module service/message-checkpoint/impl/message-checkpoint.service
 */

import {
  backfillBaselineCheckpoints,
  decideBackfillShortCircuit,
} from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { listSessionFileHeads } from "@/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import {
  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
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
export class DefaultMessageCheckpointService
  implements MessageCheckpointService
{
  constructor(private readonly deps: MessageCheckpointServiceDeps) {}

  /**
   * @remarks listSessionFileHeads 移入事务内执行，持锁扫描避免并发 capture 捕获陈旧 head。
   */
  async capture(
    sessionId: string,
    projectId: string,
    messageId: string
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      // listSessionFileHeads 在事务内调：用绑定 tx 的 entry repo 持锁扫描，
      // 避免并发 capture 读到未提交的 head（V8）。
      const txEntries = new SqliteVfsEntryRepository(tx);
      const files = await listSessionFileHeads(txEntries, projectId, sessionId);
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
   * 入口先做两段式「无空窗」短路判定（游标计数比对 + 新增段有界覆盖比对），
   * 判定不确定时保守回退全量扫描；判定与游标读写均在本事务内完成。
   */
  async backfillMissingBaselines(
    sessionId: string,
    projectId: string
  ): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      const txEntries = new SqliteVfsEntryRepository(tx);
      const txMessages = new SqliteMessageRepository(tx);
      const txCheckpoints = new SqliteMessageCheckpointRepository(tx);
      const txSessionKkv = new SqliteSessionKkvRepository(tx);

      const decision = await decideBackfillShortCircuit({
        sessionKkv: txSessionKkv,
        messageRepo: txMessages,
        checkpointRepo: txCheckpoints,
        sessionId,
      });

      if (decision.kind === "short-circuit") {
        // 游标只在值前移时写（count == 游标的短路不产生写入）。
        if (decision.newCursor !== decision.previousCursor) {
          await txSessionKkv.set(
            sessionId,
            SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
            BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
            String(decision.newCursor)
          );
        }
        return;
      }

      // 回退路径：现有全量逻辑不动；跑完确认无空窗才补写游标（无 live 文件
      // 时无法建点也无法验证，不算确认——游标留空让下次继续走全量）。
      const result = await backfillBaselineCheckpoints(
        txEntries,
        txMessages,
        txCheckpoints,
        projectId,
        sessionId
      );
      if (result.confirmedNoGap) {
        await txSessionKkv.set(
          sessionId,
          SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
          BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
          String(decision.count)
        );
      }
    });
  }

  /**
   * {@link release} 的默认实现：直接用连接构造 repo 删行。
   *
   * 单条 delete 不值得再裹一层事务——`deleteCheckpointsForMessages` 本身就是一条
   * 确定 SQL，没有中间态。幂等：消息没有 checkpoint 时 repo 层也不会抛错。
   */
  async release(sessionId: string, messageId: string): Promise<void> {
    const checkpoints = new SqliteMessageCheckpointRepository(this.deps.conn);
    await checkpoints.deleteCheckpointsForMessages(sessionId, [messageId]);
  }
}
