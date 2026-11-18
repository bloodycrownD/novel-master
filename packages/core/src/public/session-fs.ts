/**
 * Session 文件系统回滚门面与相关错误的公开入口。
 *
 * @module public/session-fs
 */

// isSessionFsError 从 errors/guards.ts 转发；三个 rollback 专用守卫的实现在
// message-checkpoint 域（domain/message-checkpoint/logic/rollback-error-guards.ts），
// apps 生产消费者在 mobile useChatTabMessageActions。
export {
  isRollbackVfsDegradableError,
  isRollbackRevisionBackfillRequiredError,
  readRollbackRevisionBackfillMissingPaths,
} from "../domain/message-checkpoint/logic/rollback-error-guards.js";
export { isSessionFsError } from "../errors/guards.js";
export type { RollbackOptions } from "../service/message-checkpoint/message-rollback.port.js";
export { createSessionFsService } from "../service/session-fs/create-session-fs-service.js";
export type { SessionFsService } from "../service/session-fs/session-fs.port.js";
