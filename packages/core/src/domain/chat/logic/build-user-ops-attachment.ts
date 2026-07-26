/**
 * 由 flush / 操作日志构造 `user_ops` 附件。
 *
 * @module domain/chat/logic/build-user-ops-attachment
 */

import {
  attachmentStorageName,
  type MessageAttachment,
} from "../model/message-attachment.schema.js";
import {
  userOpsLogEntryChipPath,
  type UserOpsLogEntry,
} from "../model/user-ops-log.schema.js";
import type {
  SynthesizedUserVfsAction,
  UserOpsActionSummary,
} from "./synthesize-user-vfs-flush-actions.js";

/**
 * 单条日志 → `user_ops` 附件：`content` = 该条 action XML；`name`/`path` = chip path。
 */
export function buildUserOpsAttachmentFromLogEntry(
  entry: UserOpsLogEntry,
): MessageAttachment {
  const storagePath = userOpsLogEntryChipPath(entry);
  return {
    name: attachmentStorageName(storagePath),
    source: "user_ops",
    type: "text",
    content: entry.actionXml.trim(),
    path: storagePath,
    action: entry.action,
  };
}

/**
 * 发送 / flush：每条未发送日志一条附件（跨次不合并）。
 */
export function buildUserOpsAttachmentsFromLogEntries(
  entries: readonly UserOpsLogEntry[],
): MessageAttachment[] {
  return entries.map(buildUserOpsAttachmentFromLogEntry);
}

/**
 * @deprecated 净 diff 合成路径；请改用 {@link buildUserOpsAttachmentFromLogEntry}。
 * 单条：`name` = path（空 → `__no_path__`），`action` 枚举，`content` 为 action XML。
 */
export function buildUserOpsAttachmentFromEntry(
  entry: SynthesizedUserVfsAction,
): MessageAttachment {
    const storagePath = entry.action === "rename" || entry.action === "move"
      ? entry.path.split("→")[1] ?? entry.path
      : entry.path;
  return {
    name: attachmentStorageName(storagePath),
    source: "user_ops",
    type: "text",
    content: entry.xml.trim(),
    path: storagePath,
    action: entry.action,
  };
}

/**
 * @deprecated 净 diff 合成路径；请改用 {@link buildUserOpsAttachmentsFromLogEntries}。
 */
export function buildUserOpsAttachmentsFromEntries(
  entries: readonly SynthesizedUserVfsAction[],
): MessageAttachment[] {
  return entries.map(buildUserOpsAttachmentFromEntry);
}

/**
 * pending 镜像到 Composer chip 的预览附件（`content` 可 null；真正 XML 在发送 flush 时合成）。
 */
export function previewPendingUserOpsAttachment(
  name = "用户操作",
): MessageAttachment {
  return {
    name,
    source: "user_ops",
    type: "text",
    content: null,
  };
}

/**
 * @deprecated 净 diff 摘要投影；状态条请改用 `chipsFromUserOpsLogStore` / `aggregateUserOpsLogChips`。
 * Composer 状态条：每条摘要一条 `user_ops`（`content: null`，`name` = path）。
 */
export function userOpsAttachmentsFromSummaries(
  summaries: readonly UserOpsActionSummary[],
): MessageAttachment[] {
  return summaries.map((summary) => {
    const storagePath = summary.action === "rename" || summary.action === "move"
      ? summary.path.split("→")[1] ?? summary.path
      : summary.path;
    return {
      name: attachmentStorageName(storagePath),
      source: "user_ops" as const,
      type: "text" as const,
      content: null,
      path: storagePath,
      action: summary.action,
    };
  });
}
