/**
 * Session 文件系统回滚门面与相关错误的公开入口。
 *
 * @module public/session-fs
 */

// 四个守卫统一从 errors/guards.ts 转发（T-S27 要求 isVfsError / isSessionFsError 都能从
// public/* 拿到）：isVfsError 在 public/vfs.ts，isSessionFsError 在本文件；其余三个是
// rollback 专用守卫，apps 生产消费者在 mobile useChatTabMessageActions。
export {
  isRollbackVfsDegradableError,
  isRollbackRevisionBackfillRequiredError,
  isSessionFsError,
  readRollbackRevisionBackfillMissingPaths,
} from "../errors/guards.js";
export type { RollbackOptions } from "../service/message-checkpoint/message-rollback.port.js";
export { createSessionFsService } from "../service/session-fs/create-session-fs-service.js";
export type { SessionFsService } from "../service/session-fs/session-fs.port.js";
