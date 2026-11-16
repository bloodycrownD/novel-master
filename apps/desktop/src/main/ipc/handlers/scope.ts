/**
 * Scope IPC — sync PersistentState project/session pointers with renderer nav.
 *
 * @module ipc/handlers/scope
 */
import type { IpcResult, ScopeSetProjectRequest, ScopeSetSessionRequest, ScopeSnapshotDto } from "../../../../shared/ipc-types.js";
import type { AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { toIpcResult } from "../ipc-result.js";

export function handleScopeGet(): Promise<IpcResult<ScopeSnapshotDto>> {
  return toIpcResult(async (): Promise<Result<ScopeSnapshotDto, AppError>> => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const currentProject = await rt.state.getCurrentProjectId();
    // 已知失败沿 Result 上行（错误通道迁移四期），handleScopeGet 经 toIpcResult 转码。
    if (!currentProject.ok) return Result.err(currentProject.error);
    let projectId = currentProject.value;
    const currentSession = await rt.state.getCurrentSessionId();
    if (!currentSession.ok) return Result.err(currentSession.error);
    let sessionId = currentSession.value;

    const projects = await rt.projects.list();
    if (projectId != null && !projects.some((p) => p.id === projectId)) {
      projectId = undefined;
      await rt.state.resetCurrentProjectId();
    }
    if (projectId == null && projects.length > 0) {
      projectId = projects[0]!.id;
      await rt.state.setCurrentProjectId(projectId);
    }

    if (projectId == null) {
      if (sessionId != null) {
        await rt.state.resetCurrentSessionId();
      }
      return Result.ok({ projectId: undefined, sessionId: undefined });
    }

    const sessions = await rt.sessions.listByProject(projectId);
    if (!sessions.ok) return Result.err(sessions.error);
    if (sessionId != null && !sessions.value.some((s) => s.id === sessionId)) {
      sessionId = undefined;
      await rt.state.resetCurrentSessionId();
    }
    if (sessionId == null && sessions.value.length > 0) {
      sessionId = sessions.value[0]!.id;
      await rt.state.setCurrentSessionId(sessionId);
    }

    return Result.ok({ projectId, sessionId });
  });
}

export function handleScopeSetProject(req: ScopeSetProjectRequest): Promise<IpcResult<ScopeSnapshotDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    await rt.state.setCurrentProjectId(req.projectId);
    const sessions = await rt.sessions.listByProject(req.projectId);
    if (!sessions.ok) return Result.err(sessions.error);
    const sessionId = sessions.value[0]?.id;
    if (sessionId != null) {
      await rt.state.setCurrentSessionId(sessionId);
    } else {
      await rt.state.resetCurrentSessionId();
    }
    return Result.ok({ projectId: req.projectId, sessionId });
  });
}

export function handleScopeSetSession(req: ScopeSetSessionRequest): Promise<IpcResult<ScopeSnapshotDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    await rt.state.setCurrentProjectId(req.projectId);
    await rt.state.setCurrentSessionId(req.sessionId);
    return Result.ok({ projectId: req.projectId, sessionId: req.sessionId });
  });
}
