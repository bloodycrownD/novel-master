/**
 * 会话 scope 用户 VFS 操作经 UserVfsTurnService 执行（pending，不 markDirty）。
 *
 * @module services/user-vfs-turn-execute.service
 */
import { type UserVfsTurnOp } from "@novel-master/core/chat";

import { type VfsScope } from "@novel-master/core/vfs";
import { notifyComposerAttachmentsSuggestToRenderer } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { projectComposerStatusForSession } from "./project-composer-status.service.js";

/** 是否为会话工作区 scope（需走 userVfsTurn）。 */
export function isSessionVfsScope(
  scope: VfsScope,
): scope is Extract<VfsScope, { kind: "session" }> {
  return scope.kind === "session";
}

/** 经 userVfsTurn 执行；失败抛错供 IPC 格式化。成功后投影整表替换状态条。 */
export async function executeSessionUserVfsOp(
  rt: DesktopNovelMasterRuntime,
  sessionId: string,
  op: UserVfsTurnOp,
): Promise<void> {
  const result = await rt.userVfsTurn.executeOp(sessionId, op);
  if (!result.ok) {
    throw result.error;
  }
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
  notifyComposerAttachmentsSuggestToRenderer({
    sessionId,
    attachments,
  });
}
