/**
 * Composer 状态条投影：组装 runtime deps → projectComposerStatusAttachments。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from '@novel-master/core/chat';
import {
  ruleViewToSnapshotEntries,
  type WorkplaceService,
} from '@novel-master/core/workplace';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import type { MobileNovelMasterRuntime } from '../runtime/types';

/** session 真源 → 状态条 attachments（workplace + user_ops）。 */
export async function projectComposerStatusForSession(
  runtime: MobileNovelMasterRuntime,
  workplace: WorkplaceService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId, {
    sessionKkv: runtime.sessionKkv,
    loadLiveWorkplacePaths: async () => {
      const view = await workplace.evaluateRuleView();
      return ruleViewToSnapshotEntries(view);
    },
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
 * 不可再调用 {@link projectComposerStatusForSession}：file_cache 已空时，
 * 规则差集会把 live 中几乎全部 path 当成「未加载」而灌满 workplace chip。
 * 正文 + `@` attach 由 replace 保留。
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
