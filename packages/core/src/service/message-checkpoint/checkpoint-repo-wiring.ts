/**
 * checkpoint 修复族的事务依赖装配（infra 仓储从 domain 迁出）。
 *
 * 单一装配点：conn / tx 面的具体仓储只在这里构造；`conn.transaction` 回调内
 * 必须用回调传入的 tx 现造（外层 conn 会重入驱动 AsyncMutex——那是死锁不是报错）。
 *
 * @module service/message-checkpoint/checkpoint-repo-wiring
 */

import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { truncateTailInTransaction, type TruncateTailDeps, type TruncateTailParams } from "@/domain/message-checkpoint/logic/truncate-tail-in-transaction.js";
import type { CheckpointRepoDeps } from "@/domain/message-checkpoint/model/checkpoint-repo-deps.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

export type { TruncateTailDeps, TruncateTailParams };
export { truncateTailInTransaction };

/** 构造 checkpoint / VFS 修复族共享的三个仓储依赖（conn 或事务 tx 均可）。 */
export function createCheckpointRepoDeps(conn: TdbcConnection): CheckpointRepoDeps {
  return {
    entryRepo: new SqliteVfsEntryRepository(conn),
    revisionRepo: new SqliteVfsRevisionRepository(conn),
    checkpointRepo: new SqliteMessageCheckpointRepository(conn),
  };
}

/**
 * 从事务连接构造 {@link TruncateTailDeps}。
 *
 * 只带截断链消费的 4 项（history 期的 entryRepo / conn 已随弃参删除）；
 * checkpoint / revision 两项复用 {@link createCheckpointRepoDeps}。
 */
export function createTruncateTailDepsFromTx(tx: TdbcConnection): TruncateTailDeps {
  const { checkpointRepo, revisionRepo } = createCheckpointRepoDeps(tx);
  return {
    messageRepo: new SqliteMessageRepository(tx),
    checkpointRepo,
    revisionRepo,
    sessionKkv: new SqliteSessionKkvRepository(tx),
  };
}
