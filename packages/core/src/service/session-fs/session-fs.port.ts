/**
 * Session file system service port (message rollback facade).
 *
 * @module service/session-fs/session-fs.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { RollbackOptions } from "@/service/message-checkpoint/message-rollback.port.js";

/**
 * Session-scoped rollback entry point (delegates to message checkpoint restore).
 */
export interface SessionFsService {
    /**
   * Restores the session workspace to the anchor message checkpoint tree (v2 forward-restore),
   * then deletes messages with `seq > anchor.seq` and tail checkpoints.
   *
   * Reconciles only paths in `tail checkpoint files ∪ target tree keys` — pre-anchor manual
   * VFS writes (FileEditor) stay unless a tail checkpoint touched the same path.
   * Anchor without its own checkpoint uses the nearest prior checkpoint tree (or empty baseline).
   *
   * 名字点明「files」：本门面只负责工作区/VFS 面（分层的稳定 API），消息截断与
   * 回滚计划装配的唯一实现在 `MessageRollbackService.rollbackToMessage`。
   */
    rollbackFilesToMessage(sessionId: string, projectId: string, messageId: string, options?: RollbackOptions): Promise<Result<void, AppError>>;
}
