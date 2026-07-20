/**
 * Desktop Composer 状态条投影（main 进程）。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from "@novel-master/core/chat";
import {
  ruleViewToSnapshotEntries,
  type WorkplaceService,
} from "@novel-master/core/workplace";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** session 真源 → 状态条 attachments（workplace + user_ops）。 */
export async function projectComposerStatusForSession(
  rt: DesktopNovelMasterRuntime,
  workplace: WorkplaceService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId, {
    sessionKkv: rt.sessionKkv,
    loadLiveWorkplacePaths: async () => {
      const view = await workplace.evaluateRuleView();
      return ruleViewToSnapshotEntries(view);
    },
    previewUserOpsActions: async (id) => {
      // chip 以 pending 为门闩：flush 清队列后上条必空
      if (!(await rt.userVfsTurn.hasPendingTurns(id))) {
        return [];
      }
      return rt.userVfsTurn.previewUserOpsActions(id);
    },
  });
}
