/**
 * 用户 VFS pending 队列 wire 类型与 zod 校验。
 *
 * 存储位：session kkv 域 `user_vfs_pending`、键 `queue`。
 *
 * @module domain/chat/model/user-vfs-pending.schema
 */

import { z } from "zod";

/** 单条 pending 中的 tool 摘要（不含 result / input）。 */
export const userVfsPendingToolSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

/** 单条用户 VFS pending 操作。 */
export const userVfsPendingEntrySchema = z
  .object({
    actionXml: z.string().min(1),
    tools: z.array(userVfsPendingToolSchema).min(1),
    createdAtMs: z.number().int().nonnegative(),
  })
  .strict();

/** FIFO pending 队列（JSON 数组）。 */
export const userVfsPendingQueueSchema = z.array(userVfsPendingEntrySchema);

export type UserVfsPendingTool = z.infer<typeof userVfsPendingToolSchema>;
export type UserVfsPendingEntry = z.infer<typeof userVfsPendingEntrySchema>;
export type UserVfsPendingQueue = z.infer<typeof userVfsPendingQueueSchema>;
