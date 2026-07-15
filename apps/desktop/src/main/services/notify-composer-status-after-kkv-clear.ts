/**
 * session kkv 清空后：重投影 Composer 状态条并推送给 renderer（上条应空）。
 * 不清 composer_draft（正文+attach 保留）。
 */
import { notifyComposerAttachmentsSuggestToRenderer } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { projectComposerStatusForSession } from "./project-composer-status.service.js";

export async function notifyComposerStatusAfterSessionKkvCleared(
  rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  const session = await rt.sessions.get(sessionId);
  const worktree = rt.worktree({
    kind: "session",
    projectId: session.projectId,
    sessionId,
  });
  const attachments = await projectComposerStatusForSession(
    rt,
    worktree,
    sessionId,
  );
  notifyComposerAttachmentsSuggestToRenderer({ sessionId, attachments });
}
