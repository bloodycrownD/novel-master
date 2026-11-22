/**
 * 将 main 进程 VFS / worktree 变更通知推送给 renderer，触发 Explorer 实时刷新。
 */
import { IPC_CHANNELS, type VfsScopeRequest, type WorkspaceMutatedPayload } from "../../../shared/ipc-types.js";
import { EventForwarder } from "./event-forwarder.js";

/** 注册 renderer webContents 解析器（与 agent stream 转发共用同一窗口策略）。 */
export const WorkspaceMutatedForwarder = {
    ...EventForwarder.create<WorkspaceMutatedPayload>(IPC_CHANNELS.WORKSPACE_MUTATED),
    /** 从 IPC 请求构造工作区变更通知载荷。 */
    payloadFromRequest: (req: VfsScopeRequest): WorkspaceMutatedPayload => ({ workspaceScope: req.workspaceScope, projectId: req.projectId, sessionId: req.sessionId }),
} as const;
