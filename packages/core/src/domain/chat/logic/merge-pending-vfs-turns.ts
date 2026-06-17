/**
 * burst flush：FIFO 合并 pending 队列为单组 actionXml。
 *
 * @module domain/chat/logic/merge-pending-vfs-turns
 */

import type { UserVfsPendingEntry } from "../model/user-vfs-pending.schema.js";

export type MergedPendingVfsTurn = { readonly actionsXml: string };

/**
 * 按 FIFO 合并 pending 条目；不调用 ToolRunner（磁盘已在各次操作时更新）。
 */
export function mergePendingVfsTurns(
  pending: readonly UserVfsPendingEntry[],
): MergedPendingVfsTurn {
  return { actionsXml: pending.map((entry) => entry.actionXml).join("\n") };
}
