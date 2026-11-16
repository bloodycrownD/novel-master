/**
 * Session FS 回滚错误的结构守卫。
 *
 * 类与旧域短码联合已退役，构造统一
 * `new AppError("SESSION_FS_*", params)`（`this.name = key`）；守卫按 AppError
 * 的数字码落在 SESSION_FS 域段判中（116 段），guards 统一后
 * {@link isSessionFsError} 是 errors/guards.ts 的 {@link inDomain} 一行组合，
 * cause 链回溯由 inDomain 统一承担（总纲 §7.2-3）。{@link isSessionFsError}
 * 本身保留（core 内部 message-rollback 消费）；三个 rollback 语义守卫已原样
 * 搬进 errors/guards.ts，public/session-fs 从那里转发。
 *
 * @module errors/session-fs-errors
 */

import { inDomain, type AppErrorGuard } from "@/errors/guards.js";

/** 结构守卫：AppError 且 `code` 落在 SESSION_FS 域段（116000-116999），沿 cause 链回溯。 */
export const isSessionFsError: AppErrorGuard = (e) => inDomain(e, "SESSION_FS");
