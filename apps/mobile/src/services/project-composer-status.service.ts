/**
 * Composer 状态条投影：仅 annotate（user ops 拆除后收窄保留，D7）。
 */
import { chipsFromAnnotateStore, type MessageAttachment } from '@novel-master/core/chat';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import type { MobileNovelMasterRuntime } from '../runtime/types';

/**
 * session 真源 → 状态条 attachments（仅 annotate chip）。
 * `runtime` 保留签名稳定（调用方不必改）；user ops 投影已随 store 拆除。
 */
export async function projectComposerStatusForSession(
  _runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return chipsFromAnnotateStore(sessionId);
}

/**
 * Undo 中间态 / 手动重置常驻：直接清空状态条（Undo 可作中间态，随后反投影）。
 *
 * 正文 + `@` attach 由 replace 保留；本函数只清 UI 上条。
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
 * 置位 / 压缩成功：project(annotate)（`apply` 内 ∪ annotate）；禁止终态强制 `[]`。
 * annotate store 保留。
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
