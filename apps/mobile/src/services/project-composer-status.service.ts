/**
 * Composer 状态条投影：Core 读 UserOpsLogStore → ops chip；App 仅 ∪ annotate。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from '@novel-master/core/chat';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import type { MobileNovelMasterRuntime } from '../runtime/types';

/**
 * session 真源 → 状态条 attachments（仅 user_ops）。
 * Core `projectComposerStatusAttachments` 读进程内 log store；App 侧再 ∪ annotate。
 * `runtime` 保留签名稳定（调用方不必改）；投影不再走 preview 净 diff。
 */
export async function projectComposerStatusForSession(
  _runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId);
}

/**
 * Undo 中间态 / 手动重置常驻：直接清空状态条（Undo 可作中间态，随后反投影）。
 *
 * 正文 + `@` attach 由 replace 保留。
 * 手动重置：调用方须先 `clearUserOpsLog`（与 clearSession 对称），本函数只清 UI 上条。
 */
export async function refreshComposerStatusAfterSessionKkvCleared(
  _runtime: MobileNovelMasterRuntime,
  scope: { readonly projectId: string; readonly sessionId: string },
): Promise<void> {
  applyComposerStatusAttachmentsReplace({
    sessionId: scope.sessionId,
    attachments: [],
  });
}

/**
 * 置位 / 压缩成功：project(ops) ∪ annotate（`apply` 内 ∪）；禁止终态强制 `[]`。
 * 未发送 ops-log store 保留（对齐 annotate）。
 */
export async function refreshComposerStatusAfterFloorOrCompaction(
  runtime: MobileNovelMasterRuntime,
  scope: { readonly projectId: string; readonly sessionId: string },
): Promise<void> {
  const attachments = await projectComposerStatusForSession(
    runtime,
    scope.sessionId,
  );
  applyComposerStatusAttachmentsReplace({
    sessionId: scope.sessionId,
    attachments,
  });
}
