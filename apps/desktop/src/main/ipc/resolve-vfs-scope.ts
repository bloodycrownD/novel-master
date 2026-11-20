/**
 * Maps renderer workspace panel scope to Core {@link VfsScope} + VFS service handles.
 *
 * @module ipc/resolve-vfs-scope
 */
import { type VfsScope, type VfsService } from "@novel-master/core/vfs";
import type { IpcResult, VfsScopeRequest } from "../../../shared/ipc-types.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export const ResolveVfsScope = {
  /**
   * Resolves IPC workspace panel to Core VFS scope.
   *
   * scope 参数校验（A 类域校验）走返回值通道，不再 throw：失败即
   * `{ok:false, error:{code:IPC_INVALID_ARGUMENT}}` 直构 wire payload（code 是
   * ErrorKey，message 保留原文），handler 侧 `if (!res.ok) return res;` 透传。
   */
  fromRequest(req: VfsScopeRequest): IpcResult<VfsScope> {
    switch (req.workspaceScope) {
      case "global":
        return { ok: true, data: { kind: "global" } };
      case "global-meta":
        // 技能存储重定位后的全局 meta 域（逻辑前缀 /meta/skills/）
        return { ok: true, data: { kind: "global-meta" } };
      case "project-meta":
        if (req.projectId == null || req.projectId === "") return { ok: false, error: { code: "IPC_INVALID_ARGUMENT", message: "缺少 projectId" } };
        return { ok: true, data: { kind: "project-meta", projectId: req.projectId } };
      case "session":
        if (req.projectId == null || req.projectId === "") return { ok: false, error: { code: "IPC_INVALID_ARGUMENT", message: "缺少 projectId" } };
        return { ok: true, data: { kind: "project", projectId: req.projectId } };
      case "chat":
        if (req.projectId == null || req.projectId === "") return { ok: false, error: { code: "IPC_INVALID_ARGUMENT", message: "缺少 projectId" } };
        if (req.sessionId == null || req.sessionId === "") return { ok: false, error: { code: "IPC_INVALID_ARGUMENT", message: "缺少 sessionId" } };
        return { ok: true, data: { kind: "session", projectId: req.projectId, sessionId: req.sessionId } };
      case "physical":
        // 物理树是跨域拼接的只读浏览域，不解析为单 scope：
        // 浏览走 getPhysicalVfs（仅 list/read）；写通道在此显式拒绝。
        return { ok: false, error: { code: "IPC_INVALID_ARGUMENT", message: "physical 为只读物理树浏览域，不提供单 scope VFS 读写" } };
      default:
        return { ok: false, error: { code: "IPC_INVALID_ARGUMENT", message: `未知 workspaceScope: ${String(req.workspaceScope)}` } };
    }
  },

  getVfsForScope(rt: DesktopNovelMasterRuntime, scope: VfsScope): VfsService {
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
  },

  /**
   * 只读物理树分流入口：physical 不落单 scope，浏览 handler 直接走此工厂。
   * 服务类型层面即无写方法（write/mkdir/delete/rename 不存在）。
   */
  getPhysicalVfs(rt: DesktopNovelMasterRuntime) {
    return rt.physicalVfs();
  },

  getWorkplaceForScope(rt: DesktopNovelMasterRuntime, scope: VfsScope) {
    return rt.workplace(scope);
  },
} as const;
