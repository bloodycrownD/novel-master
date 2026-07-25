/**
 * Composer 状态条投影：读 UserOpsLogStore → 按 path 聚合 MessageAttachment[]。
 * App 层仅 ∪ annotate；禁止 App 再 ∪ ops-log。
 *
 * @module domain/chat/logic/project-composer-status-attachments
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import type { UserOpsLogEntry } from "../model/user-ops-log.schema.js";
import { aggregateUserOpsLogChips } from "./aggregate-user-ops-log-chips.js";
import { listUserOpsLog } from "./chat-user-ops-log-store.js";
import type { UserOpsActionSummary } from "./synthesize-user-vfs-flush-actions.js";

/**
 * `projectComposerStatusAttachments` 所需依赖。
 * 默认读进程内 store；可注入 `listUserOpsLogEntries`（测试 / 自定义）。
 */
export type ProjectComposerStatusAttachmentsDeps = {
  readonly listUserOpsLogEntries?: (
    sessionId: string,
  ) => readonly UserOpsLogEntry[];
  /**
   * @deprecated 已忽略；手改 chip 改读 UserOpsLogStore。
   * 过渡期保留字段以免 Desktop/Mobile 旧调用方编译失败。
   */
  readonly previewUserOpsActions?: (
    sessionId: string,
  ) => Promise<readonly UserOpsActionSummary[]>;
};

/**
 * 由操作日志合成状态条附件（按 path 去重；action 取该 path 最后一条）。
 */
export function buildComposerStatusAttachments(
  entries: readonly UserOpsLogEntry[],
): MessageAttachment[] {
  return aggregateUserOpsLogChips(entries);
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
 * session 真源（未发送 ops-log）→ Composer 状态条 `MessageAttachment[]`（仅 user_ops）。
 */
export async function projectComposerStatusAttachments(
  sessionId: string,
  deps: ProjectComposerStatusAttachmentsDeps = {},
): Promise<MessageAttachment[]> {
  const entries =
    deps.listUserOpsLogEntries?.(sessionId) ?? listUserOpsLog(sessionId);
  return buildComposerStatusAttachments(entries);
}
