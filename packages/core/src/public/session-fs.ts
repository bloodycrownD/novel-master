/**
 * Session 文件系统回滚门面与相关错误的公开入口。
 *
 * @module public/session-fs
 */

// isSessionFsError 已撤（apps 全树零命中，core 内部 message-rollback 照用，测试走 src 路径）；
// 旧域短码联合已撤（全仓零消费者）。保留的三个守卫已随 guards 统一搬进 errors/guards.ts
// （原样搬运），apps 生产消费者在 mobile useChatTabMessageActions。
export {
  isRollbackVfsDegradableError,
  isRollbackRevisionBackfillRequiredError,
  readRollbackRevisionBackfillMissingPaths,
} from "../errors/guards.js";
export type { RollbackOptions } from "../service/message-checkpoint/message-rollback.port.js";
export { createSessionFsService } from "../service/session-fs/create-session-fs-service.js";
export type { SessionFsService } from "../service/session-fs/session-fs.port.js";
