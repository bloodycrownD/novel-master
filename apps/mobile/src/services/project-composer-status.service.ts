/**
 * Composer 状态条投影：仅 annotate（user ops 拆除后收窄保留，D7）。
 *
 * 十七期第2轮签名审计（与 desktop 同款）：runtime 首参双端都未被引用
 * （`chatAnnotateDraftStore` 是 core 全局单例），已删除。投影真源在 core，
 * 本层只剩投递形态差异（mobile 落 storage，desktop 走 IPC 推送）。
 */
import {chatAnnotateDraftStore, type MessageAttachment} from '@novel-master/core/chat';
import {ChatComposerDraft} from '@/storage/chat-composer-draft';

export namespace ProjectComposerStatusService {
  /** session 真源 → 状态条 attachments（仅 annotate chip）。 */
  export async function forSession(sessionId: string): Promise<MessageAttachment[]> {
    return chatAnnotateDraftStore.chips(sessionId);
  }

  /**
   * Undo 中间态 / 手动重置常驻：直接清空状态条（Undo 可作中间态，随后反投影）。
   *
   * 正文 + `@` attach 由 replace 保留；本函数只清 UI 上条。
   */
  export async function refreshAfterSessionKkvCleared(scope: {readonly projectId: string; readonly sessionId: string}): Promise<void> {
    ChatComposerDraft.applyComposerStatusAttachmentsReplace({
      sessionId: scope.sessionId,
      attachments: [],
    });
  }

  /**
   * 置位 / 压缩成功：project(annotate)（`apply` 内 ∪ annotate）；禁止终态强制 `[]`。
   * annotate store 保留。
   */
  export async function refreshAfterFloorOrCompaction(scope: {readonly projectId: string; readonly sessionId: string}): Promise<void> {
    const attachments = await forSession(scope.sessionId);
    ChatComposerDraft.applyComposerStatusAttachmentsReplace({
      sessionId: scope.sessionId,
      attachments,
    });
  }
}
