/**
 * 手改操作日志 → Composer 状态条 chip（按 path 去重一颗；文案取该 path 最后一条）。
 *
 * @module domain/chat/logic/aggregate-user-ops-log-chips
 */

import {
  userOpsLogEntryChipPath,
  type UserOpsLogEntry,
} from "../model/user-ops-log.schema.js";
import {
  attachmentStorageName,
  type MessageAttachment,
  type MessageAttachmentAction,
} from "../model/message-attachment.schema.js";

/** 日志 action → 附件 action（落库枚举；chip 文案由 STATUS_CHIP_ZH 映射「创建」等）。 */
function toAttachmentAction(
  entry: UserOpsLogEntry,
): MessageAttachmentAction {
  return entry.action;
}

/**
 * 按 path 聚合：同 path 多条日志 → 一颗 chip；`action` 取该 path **最后一条**。
 * 出现顺序按各 path 首次出现保留。
 */
export function aggregateUserOpsLogChips(
  entries: readonly UserOpsLogEntry[],
): MessageAttachment[] {
  const lastByPath = new Map<string, UserOpsLogEntry>();
  for (const entry of entries) {
    lastByPath.set(userOpsLogEntryChipPath(entry), entry);
  }

  const seen = new Set<string>();
  const chips: MessageAttachment[] = [];
  for (const entry of entries) {
    const path = userOpsLogEntryChipPath(entry);
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    const last = lastByPath.get(path)!;
    chips.push({
      name: attachmentStorageName(path),
      source: "user_ops",
      type: "text",
      content: null,
      path,
      action: toAttachmentAction(last),
    });
  }
  return chips;
}
