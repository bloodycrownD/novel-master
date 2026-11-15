/**
 * Scope IPC — sync PersistentState project/session pointers with renderer nav.
 *
 * @module ipc/handlers/scope
 */
import type {
  IpcResult,
  ScopeSetProjectRequest,
  ScopeSetSessionRequest,
  ScopeSnapshotDto,
} from "../../../../shared/ipc-types.js";
import { type AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";
import { ipcErr } from "../ipc-result.js";

/** Loads persisted pointers and reconciles against project/session lists. */
async function loadDesktopScope(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
): Promise<Result<ScopeSnapshotDto, AppError>> {
  const currentProject = await rt.state.getCurrentProjectId();
  // 已知失败沿 Result 上行（错误通道迁移四期），handleScopeGet 转码。
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
}

export async function handleScopeGet(): Promise<IpcResult<ScopeSnapshotDto>> {
  try {
    const rt = await getDesktopRuntime();
    const scope = await loadDesktopScope(rt);
    if (!scope.ok) return { ok: false, error: formatIpcError(scope.error) };
    return { ok: true, data: scope.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleScopeSetProject(
  req: ScopeSetProjectRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setCurrentProjectId(req.projectId);
    const sessions = await rt.sessions.listByProject(req.projectId);
    if (!sessions.ok) return ipcErr(formatIpcError(sessions.error));
    const sessionId = sessions.value[0]?.id;
    if (sessionId != null) {
      await rt.state.setCurrentSessionId(sessionId);
    } else {
      await rt.state.resetCurrentSessionId();
    }
    return {
      ok: true,
      data: { projectId: req.projectId, sessionId },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleScopeSetSession(
  req: ScopeSetSessionRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setCurrentProjectId(req.projectId);
    await rt.state.setCurrentSessionId(req.sessionId);
    return {
      ok: true,
      data: { projectId: req.projectId, sessionId: req.sessionId },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
