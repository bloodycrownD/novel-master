/**
 * Message checkpoint service factories.
 *
 * @module service/message-checkpoint/create-message-checkpoint-services
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { DefaultMessageCheckpointService } from "./impl/message-checkpoint.service.js";
import { DefaultMessageRollbackService } from "./impl/message-rollback.service.js";
import type { MessageCheckpointService } from "./message-checkpoint.port.js";
import type {
  MessageRollbackService,
  RollbackProbe,
} from "./message-rollback.port.js";

/**
 * Creates a {@link MessageCheckpointService} for the given connection.
 */
export function createMessageCheckpointService(
  conn: TdbcConnection
): MessageCheckpointService {
  return new DefaultMessageCheckpointService({
    conn,
    entries: new SqliteVfsEntryRepository(conn),
  });
}

/** {@link createMessageRollbackService} 可选装配项（均缺省 = 现状行为）。 */
export interface MessageRollbackServiceOptions {
  /**
   * 回滚链分段打点探针（rollback-large-jank Step 1）：mobile 在 __DEV__
   * 下注入；desktop/cli 不注入（恒 no-op）。
   */
  readonly probe?: RollbackProbe;
}

/** Creates a {@link MessageRollbackService} for the given connection. */
export function createMessageRollbackService(
  conn: TdbcConnection,
  options?: MessageRollbackServiceOptions
): MessageRollbackService {
  return new DefaultMessageRollbackService({
    conn,
    messages: new SqliteMessageRepository(conn),
    entries: new SqliteVfsEntryRepository(conn),
    revisions: new SqliteVfsRevisionRepository(conn),
    checkpoints: new SqliteMessageCheckpointRepository(conn),
    probe: options?.probe,
  });
}
