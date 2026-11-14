/**
 * Session 文件系统回滚门面与相关错误的公开入口。
 *
 * @module public/session-fs
 */

export {
  isSessionFsError,
  isRollbackVfsDegradableError,
  isRollbackRevisionBackfillRequiredError,
  readRollbackRevisionBackfillMissingPaths,
} from "../errors/session-fs-errors.js";
export type { SessionFsErrorCode } from "../errors/session-fs-errors.js";
export type { RollbackOptions } from "../service/message-checkpoint/message-rollback.port.js";
export { createSessionFsService } from "../service/session-fs/create-session-fs-service.js";
export type { SessionFsService } from "../service/session-fs/session-fs.port.js";
