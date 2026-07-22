/**
 * Composer 状态条投影：组装 runtime deps → projectComposerStatusAttachments。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from '@novel-master/core/chat';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import type { MobileNovelMasterRuntime } from '../runtime/types';

/** session 真源 → 状态条 attachments（仅 user_ops；App 侧再 ∪ annotate）。 */
export async function projectComposerStatusForSession(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId, {
    previewUserOpsActions: async id => {
      // chip 以 pending 为门闩：flush 清队列后上条必空，避免「pending 已空但 checkpoint 落后」粘住 mkdir 等 chip
      if (!(await runtime.userVfsTurn.hasPendingTurns(id))) {
        return [];
      }
      return runtime.userVfsTurn.previewUserOpsActions(id);
    },
  });
}

/**
 * Undo / 手动重置常驻：直接清空状态条（Undo 可作中间态，随后反投影批注）。
 *
 * 正文 + `@` attach 由 replace 保留。
 * 手动重置已知限制：会丢未发送手改 ops 投影（仍 clearSession）。
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
