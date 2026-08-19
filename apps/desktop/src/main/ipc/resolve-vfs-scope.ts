/**
 * Maps renderer workspace panel scope to Core {@link VfsScope} + VFS service handles.
 *
 * @module ipc/resolve-vfs-scope
 */
import { type VfsScope, type VfsService } from "@novel-master/core/vfs";
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
    case "global-meta":
      // 技能存储重定位后的全局 meta 域（逻辑前缀 /meta/skills/）
      return { kind: "global-meta" };
    case "project-meta":
      if (req.projectId == null || req.projectId === "") {
        throw new VfsScopeError("缺少 projectId");
      }
      return { kind: "project-meta", projectId: req.projectId };
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
    case "physical":
      // 物理树是跨域拼接的只读浏览域，不解析为单 scope：
      // 浏览走 getPhysicalVfs（仅 list/read）；写通道在此显式拒绝。
      throw new VfsScopeError(
        "physical 为只读物理树浏览域，不提供单 scope VFS 读写",
      );
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
    case "global-meta":
      return rt.globalMetaVfs();
    case "project-meta":
      return rt.projectMetaVfs(scope.projectId);
    case "project":
      return rt.projectVfs(scope.projectId);
    case "session":
      return rt.sessionVfs(scope.projectId, scope.sessionId);
  }
}

/**
 * 只读物理树分流入口：physical 不落单 scope，浏览 handler 直接走此工厂。
 * 服务类型层面即无写方法（write/mkdir/delete/rename 不存在）。
 */
export function getPhysicalVfs(rt: DesktopNovelMasterRuntime) {
  return rt.physicalVfs();
}

export function getWorkplaceForScope(
  rt: DesktopNovelMasterRuntime,
  scope: VfsScope,
) {
  return rt.workplace(scope);
}
