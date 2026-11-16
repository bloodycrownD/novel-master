/**
 * Default SessionFsService implementation.
 *
 * @module service/session-fs/impl/session-fs.service
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { RollbackOptions } from "@/service/message-checkpoint/message-rollback.port.js";
import type { MessageRollbackService } from "@/service/message-checkpoint/message-rollback.port.js";
import type { SessionFsService } from "../session-fs.port.js";

/** Dependencies for {@link DefaultSessionFsService}. */
export interface SessionFsServiceDeps {
  readonly messageRollback: MessageRollbackService;
}

/**
 * Thin facade over {@link MessageRollbackService} for cross-app rollback API stability.
 */
export class DefaultSessionFsService implements SessionFsService {
  constructor(private readonly deps: SessionFsServiceDeps) {}

  async rollbackToMessage(
    sessionId: string,
    projectId: string,
    messageId: string,
    options?: RollbackOptions
  ): Promise<Result<void, AppError>> {
    return this.deps.messageRollback.rollbackToMessage(
      sessionId,
      projectId,
      messageId,
      options
    );
  }
}
