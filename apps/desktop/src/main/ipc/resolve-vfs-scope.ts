/**
 * Maps renderer workspace panel scope to Core {@link VfsScope} + VFS service handles.
 *
 * @module ipc/resolve-vfs-scope
 */
import type { VfsScope, VfsService } from "@novel-master/core";
import type { VfsScopeRequest } from "../../../shared/ipc-types.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export class VfsScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VfsScopeError";
  }
}

/** Resolves IPC workspace panel to Core VFS scope. */
export function resolveVfsScopeFromRequest(req: VfsScopeRequest): VfsScope {
  switch (req.workspaceScope) {
    case "global":
      return { kind: "global" };
    case "session":
      if (req.projectId == null || req.projectId === "") {
        throw new VfsScopeError("缺少 projectId");
      }
      return { kind: "project", projectId: req.projectId };
    case "chat":
      if (req.projectId == null || req.projectId === "") {
        throw new VfsScopeError("缺少 projectId");
      }
      if (req.sessionId == null || req.sessionId === "") {
        throw new VfsScopeError("缺少 sessionId");
      }
      return {
        kind: "session",
        projectId: req.projectId,
        sessionId: req.sessionId,
      };
    default:
      throw new VfsScopeError(`未知 workspaceScope: ${String(req.workspaceScope)}`);
  }
}

export function getVfsForScope(
  rt: DesktopNovelMasterRuntime,
  scope: VfsScope,
): VfsService {
  switch (scope.kind) {
    case "global":
      return rt.globalVfs();
    case "project":
      return rt.projectVfs(scope.projectId);
    case "session":
      return rt.sessionVfs(scope.projectId, scope.sessionId);
  }
}

export function getWorktreeForScope(
  rt: DesktopNovelMasterRuntime,
  scope: VfsScope,
) {
  return rt.worktree(scope);
}

/** 会话 scope VFS / 规则变更后标记 worktree 快照 dirty。 */
export function invalidateSessionWorktreeSnapshot(
  rt: DesktopNovelMasterRuntime,
  scope: VfsScope,
): void {
  if (scope.kind === "session") {
    rt.worktreeSnapshot.markDirty(scope.projectId, scope.sessionId);
  }
}

/** @deprecated 使用 {@link invalidateSessionWorktreeSnapshot} */
export const invalidateSessionMacroCache = invalidateSessionWorktreeSnapshot;
