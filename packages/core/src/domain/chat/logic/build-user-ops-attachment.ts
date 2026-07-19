/**
 * 由 flush 同源 action 条目构造 `user_ops` 附件。
 *
 * @module domain/chat/logic/build-user-ops-attachment
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import {
  formatUserOpsActionLabel,
  type SynthesizedUserVfsAction,
  type UserOpsActionSummary,
} from "./synthesize-user-vfs-flush-actions.js";

/**
 * 单条：`name` = `action:path`，`content` 为现网同源 action XML。
 */
export function buildUserOpsAttachmentFromEntry(
  entry: SynthesizedUserVfsAction,
): MessageAttachment {
  const storagePath = entry.action === "rename"
    ? entry.path.split("→")[1] ?? entry.path
    : entry.path;
  return {
    name: formatUserOpsActionLabel(entry),
    source: "user_ops",
    type: "text",
    content: entry.xml.trim(),
    path: storagePath,
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
 * @deprecated 优先用 `buildUserOpsAttachmentsFromEntries`；保留兼容单包 XML。
 */
export function buildUserOpsAttachment(
  actionsXml: string,
  name = "user_ops",
): MessageAttachment {
  return {
    name,
    source: "user_ops",
    type: "text",
    content: actionsXml.trim(),
  };
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
 * Composer 状态条：每条摘要一条 `user_ops`（`content: null`，`name` = `action:path`）。
 */
export function userOpsAttachmentsFromSummaries(
  summaries: readonly UserOpsActionSummary[],
): MessageAttachment[] {
  return summaries.map((summary) => {
    const storagePath = summary.action === "rename"
      ? summary.path.split("→")[1] ?? summary.path
      : summary.path;
    return {
      name: formatUserOpsActionLabel(summary),
      source: "user_ops" as const,
      type: "text" as const,
      content: null,
      path: storagePath,
    };
  });
}
