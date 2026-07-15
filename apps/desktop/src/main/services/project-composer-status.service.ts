/**
 * Desktop Composer 状态条投影（main 进程）。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from "@novel-master/core/chat";
import {
  ruleViewToSnapshotEntries,
  type WorktreeService,
} from "@novel-master/core/worktree";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** session 真源 → 状态条 attachments（workplace + user_ops）。 */
export async function projectComposerStatusForSession(
  rt: DesktopNovelMasterRuntime,
  worktree: WorktreeService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId, {
    sessionKkv: rt.sessionKkv,
    loadLiveWorkplacePaths: async () => {
      const view = await worktree.evaluateRuleView();
      return ruleViewToSnapshotEntries(view);
    },
    previewUserOpsChangedPaths: (id) =>
      rt.userVfsTurn.previewUserOpsChangedPaths(id),
  });
}
