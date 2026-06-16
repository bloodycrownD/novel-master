/**
 * 会话 scope 用户 VFS 操作经 UserVfsTurnService 执行（pending，不 markDirty）。
 *
 * @module services/user-vfs-turn-execute.service
 */
import { type UserVfsTurnOp } from "@novel-master/core/chat";

import { type VfsScope } from "@novel-master/core/vfs";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** 是否为会话工作区 scope（需走 userVfsTurn）。 */
export function isSessionVfsScope(
  scope: VfsScope,
): scope is Extract<VfsScope, { kind: "session" }> {
  return scope.kind === "session";
}

/** 经 userVfsTurn 执行；失败抛错供 IPC 格式化。 */
export async function executeSessionUserVfsOp(
  rt: DesktopNovelMasterRuntime,
  sessionId: string,
  op: UserVfsTurnOp,
): Promise<void> {
  const result = await rt.userVfsTurn.executeOp(sessionId, op);
  if (!result.ok) {
    throw result.error;
  }
}
