/**
 * truncate-tail 事务依赖装配（infra 仓储从 domain 迁出）。
 *
 * @module service/message-checkpoint/truncate-tail-wiring
 */

import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  truncateTailInTransaction,
  type TruncateTailDeps,
  type TruncateTailParams,
} from "@/domain/message-checkpoint/logic/truncate-tail-in-transaction.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteSessionKkvRepository } from "@/domain/session-kkv/repositories/impl/sqlite-session-kkv.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";

export type { TruncateTailDeps, TruncateTailParams };
export { truncateTailInTransaction };

/** 从事务连接构造 {@link TruncateTailDeps}。 */
export function createTruncateTailDepsFromTx(tx: TdbcConnection): TruncateTailDeps {
  return {
    messages: new SqliteMessageRepository(tx),
    checkpoints: new SqliteMessageCheckpointRepository(tx),
    sessionKkv: new SqliteSessionKkvRepository(tx),
    revisions: new SqliteVfsRevisionRepository(tx),
    entries: new SqliteVfsEntryRepository(tx),
  };
}
