/**
 * Composer 状态条投影：仅 user_ops 净 action → MessageAttachment[]。
 * 规则差集 / workplace 半边已废止（见 composer-chip-ops-annotate-recontract）。
 *
 * @module domain/chat/logic/project-composer-status-attachments
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import { userOpsAttachmentsFromSummaries } from "./build-user-ops-attachment.js";
import type { UserOpsActionSummary } from "./synthesize-user-vfs-flush-actions.js";

/** `projectComposerStatusAttachments` 所需依赖（不绑定完整 Service）。 */
export type ProjectComposerStatusAttachmentsDeps = {
  /** 相对 checkpoint 的净 action 摘要（须走 preview，禁止 flush）。 */
  readonly previewUserOpsActions: (
    sessionId: string,
  ) => Promise<readonly UserOpsActionSummary[]>;
};

/**
 * 由 user_ops 摘要合成状态条附件（纯函数）。
 * 不再接受 live / cacheKeys：不投影 workplace。
 */
export function buildComposerStatusAttachments(
  userOpsActions: readonly UserOpsActionSummary[],
): MessageAttachment[] {
  return userOpsAttachmentsFromSummaries(userOpsActions);
}

/**
 * 用投影结果整表替换 Composer draft attachments。
 * draft attach 恒空：不再保留 existing attach，仅返回 statusProjected。
 */
export function replaceComposerStatusAttachments(
  _existing: readonly MessageAttachment[],
  statusProjected: readonly MessageAttachment[],
): MessageAttachment[] {
  return [...statusProjected];
}

/**
 * session 真源 → Composer 状态条 `MessageAttachment[]`（仅 user_ops）。
 */
export async function projectComposerStatusAttachments(
  sessionId: string,
  deps: ProjectComposerStatusAttachmentsDeps,
): Promise<MessageAttachment[]> {
  const userOpsActions = await deps.previewUserOpsActions(sessionId);
  return buildComposerStatusAttachments(userOpsActions);
}
