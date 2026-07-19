/**
 * 由 flush 同源 action 条目构造 `user_ops` 附件。
 *
 * @module domain/chat/logic/build-user-ops-attachment
 */

import {
  attachmentStorageName,
  type MessageAttachment,
} from "../model/message-attachment.schema.js";
import type {
  SynthesizedUserVfsAction,
  UserOpsActionSummary,
} from "./synthesize-user-vfs-flush-actions.js";

/**
 * 单条：`name` = path（空 → `__no_path__`），`action` 枚举，`content` 为 action XML。
 */
export function buildUserOpsAttachmentFromEntry(
  entry: SynthesizedUserVfsAction,
): MessageAttachment {
  const storagePath = entry.action === "rename"
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
 * flush 产出：每条净 action 一条附件（创建后再改同一 path 只会有一条）。
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
 * Composer 状态条：每条摘要一条 `user_ops`（`content: null`，`name` = path）。
 */
export function userOpsAttachmentsFromSummaries(
  summaries: readonly UserOpsActionSummary[],
): MessageAttachment[] {
  return summaries.map((summary) => {
    const storagePath = summary.action === "rename"
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
