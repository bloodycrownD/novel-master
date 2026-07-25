/**
 * 会话手改操作日志条目（进程内 store；发送 → user_ops 附件）。
 * edit 用 `hunks`（产品口径 `content` 数组）；落库 action 保持 write/mkdir/edit/delete/rename/move。
 *
 * @module domain/chat/model/user-ops-log.schema
 */

import { z } from "zod";

/** 单次 edit 的 hunk（与 `mapUserSaveToToolUses` / action XML 同源）。 */
export const userOpsLogHunkSchema = z
  .object({
    oldString: z.string(),
    newString: z.string(),
  })
  .strict();

export type UserOpsLogHunk = z.infer<typeof userOpsLogHunkSchema>;

const entryBase = {
  id: z.string().min(1),
  createdAtMs: z.number().int().nonnegative(),
  /** 发送用 action XML（与 execute 时 `op.actionXml` 同源）。 */
  actionXml: z.string().min(1),
};

/**
 * 单条未发送手改日志。
 * write 可带 `reason` / `kind`；rename/move 用 `oldPath`/`newPath`（chip 聚合 key = newPath）。
 */
export const userOpsLogEntrySchema = z.discriminatedUnion("action", [
  z
    .object({
      ...entryBase,
      action: z.literal("write"),
      path: z.string().min(1),
      content: z.string().optional(),
      reason: z.enum(["new-file", "anchor-not-unique"]).optional(),
      /** 文件创建时可选；目录创建走 mkdir。 */
      kind: z.enum(["file", "dir"]).optional(),
    })
    .strict(),
  z
    .object({
      ...entryBase,
      action: z.literal("edit"),
      path: z.string().min(1),
      hunks: z.array(userOpsLogHunkSchema).min(1),
    })
    .strict(),
  z
    .object({
      ...entryBase,
      action: z.literal("mkdir"),
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...entryBase,
      action: z.literal("delete"),
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...entryBase,
      action: z.literal("rename"),
      oldPath: z.string().min(1),
      newPath: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...entryBase,
      action: z.literal("move"),
      oldPath: z.string().min(1),
      newPath: z.string().min(1),
    })
    .strict(),
]);

export type UserOpsLogEntry = z.infer<typeof userOpsLogEntrySchema>;

/** 日志数组。 */
export const userOpsLogEntriesSchema = z.array(userOpsLogEntrySchema);

export type UserOpsLogEntries = z.infer<typeof userOpsLogEntriesSchema>;

/** chip / 附件聚合用 path：rename/move 取 newPath，其余取 path。 */
export function userOpsLogEntryChipPath(entry: UserOpsLogEntry): string {
  if (entry.action === "rename" || entry.action === "move") {
    return entry.newPath;
  }
  return entry.path;
}
