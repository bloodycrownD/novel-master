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
