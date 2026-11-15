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

/**
 * 经 userVfsTurn 执行；失败抛错供 IPC 格式化。
 * 成功后轻量 refresh：读 main 侧 annotate store 投影推送（无净 diff preview）。
 */
export async function executeSessionUserVfsOp(
  rt: DesktopNovelMasterRuntime,
  sessionId: string,
  op: UserVfsTurnOp,
): Promise<void> {
  const result = await rt.userVfsTurn.executeOp(sessionId, op);
  if (!result.ok) {
    // 解包 throw 边界：失败抛错供 IPC 格式化——4 个调用点落在 handlers/vfs.ts
    // 各 handler 的紧邻 try/catch（formatIpcError）；vfs-batch 侧经 core
    // BatchIngestWriter（Promise<void>）最终落 handleVfsBatchIngestFromPaths
    // 的 catch。总纲 §1.1 点名的生产接线边界（desktop+mobile 同名镜像）。
    throw result.error;
  }
  const attachments = await projectComposerStatusForSession(rt, sessionId);
  notifyComposerAttachmentsSuggestToRenderer({
    sessionId,
    attachments,
  });
}
