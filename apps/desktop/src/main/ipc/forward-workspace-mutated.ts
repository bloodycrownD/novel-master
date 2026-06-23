/**
 * 将 main 进程 VFS / worktree 变更通知推送给 renderer，触发 Explorer 实时刷新。
 */
import type { WebContents } from "electron";
import {
  IPC_CHANNELS,
  type VfsScopeRequest,
  type WorkspaceMutatedPayload,
} from "../../../shared/ipc-types.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;

/** 注册 renderer webContents 解析器（与 agent stream 转发共用同一窗口策略）。 */
export function setWorkspaceMutatedForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

/** 从 IPC 请求构造工作区变更通知载荷。 */
export function workspaceMutatedPayloadFromRequest(
  req: VfsScopeRequest,
): WorkspaceMutatedPayload {
  return {
    workspaceScope: req.workspaceScope,
    projectId: req.projectId,
    sessionId: req.sessionId,
  };
}

/** 通知 renderer 工作区列表应重载（无写权限，仅 push）。 */
export function notifyWorkspaceMutatedToRenderer(
  payload: WorkspaceMutatedPayload,
): void {
  getTargetWebContents?.()?.send(IPC_CHANNELS.WORKSPACE_MUTATED, payload);
}
