/**
 * Desktop Composer 状态条投影（main 进程）。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from "@novel-master/core/chat";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** session 真源 → 状态条 attachments（仅 user_ops；App 侧再 ∪ annotate）。 */
export async function projectComposerStatusForSession(
  rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId, {
    previewUserOpsActions: async (id) => {
      // chip 以 pending 为门闩：flush 清队列后上条必空
      if (!(await rt.userVfsTurn.hasPendingTurns(id))) {
        return [];
      }
      return rt.userVfsTurn.previewUserOpsActions(id);
    },
  });
}
