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
import type { MessageRollbackService } from "./message-rollback.port.js";

/**
 * Creates a {@link MessageCheckpointService} for the given connection.
 */
export function createMessageCheckpointService(
  conn: TdbcConnection,
): MessageCheckpointService {
  return new DefaultMessageCheckpointService({
    conn,
    entries: new SqliteVfsEntryRepository(conn),
  });
}

/** Creates a {@link MessageRollbackService} for the given connection. */
export function createMessageRollbackService(
  conn: TdbcConnection,
): MessageRollbackService {
  return new DefaultMessageRollbackService({
    conn,
    messages: new SqliteMessageRepository(conn),
    entries: new SqliteVfsEntryRepository(conn),
    revisions: new SqliteVfsRevisionRepository(conn),
    checkpoints: new SqliteMessageCheckpointRepository(conn),
  });
}
