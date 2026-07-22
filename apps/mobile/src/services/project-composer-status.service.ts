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
 * session kkv 清空后（置位 / 压缩 / 手动清缓存）：**直接清空**状态条。
 *
 * 正文 + `@` attach 由 replace 保留。
 * （置位/压缩终态改 project∪annotate 属后续 Step；本轮保持现网 `[]`。）
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
