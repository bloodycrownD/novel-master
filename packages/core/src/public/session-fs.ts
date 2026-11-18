/**
 * Session 文件系统服务的公开入口（回滚守卫与 RollbackOptions 已移至
 * `@novel-master/core/message-checkpoint`，isSessionFsError 走 `@novel-master/core/errors`）。
 *
 * @module public/session-fs
 */

export { createSessionFsService } from "../service/session-fs/create-session-fs-service.js";
export type { SessionFsService } from "../service/session-fs/session-fs.port.js";
