/**
 * Composer 状态条投影：组装 runtime deps → projectComposerStatusAttachments。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from '@novel-master/core/chat';
import {
  ruleViewToSnapshotEntries,
  type WorktreeService,
} from '@novel-master/core/worktree';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import type { MobileNovelMasterRuntime } from '../runtime/types';

/** session 真源 → 状态条 attachments（workplace + user_ops）。 */
export async function projectComposerStatusForSession(
  runtime: MobileNovelMasterRuntime,
  worktree: WorktreeService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId, {
    sessionKkv: runtime.sessionKkv,
    loadLiveWorkplacePaths: async () => {
      const view = await worktree.evaluateRuleView();
      return ruleViewToSnapshotEntries(view);
    },
    previewUserOpsChangedPaths: id =>
      runtime.userVfsTurn.previewUserOpsChangedPaths(id),
  });
}

/**
 * session kkv 清空后重投影上条（应空）；保留 composer_draft 正文+attach。
 */
export async function refreshComposerStatusAfterSessionKkvCleared(
  runtime: MobileNovelMasterRuntime,
  scope: { readonly projectId: string; readonly sessionId: string },
): Promise<void> {
  const worktree = runtime.worktree({
    kind: 'session',
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  });
  const attachments = await projectComposerStatusForSession(
    runtime,
    worktree,
    scope.sessionId,
  );
  applyComposerStatusAttachmentsReplace({
    sessionId: scope.sessionId,
    attachments,
  });
}
