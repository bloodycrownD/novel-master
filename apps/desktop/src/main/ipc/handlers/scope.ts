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
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

/** Loads persisted pointers and reconciles against project/session lists. */
async function loadDesktopScope(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
): Promise<ScopeSnapshotDto> {
  let projectId = await rt.state.getCurrentProjectId();
  let sessionId = await rt.state.getCurrentSessionId();

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
    return { projectId: undefined, sessionId: undefined };
  }

  const sessions = await rt.sessions.listByProject(projectId);
  if (sessionId != null && !sessions.some((s) => s.id === sessionId)) {
    sessionId = undefined;
    await rt.state.resetCurrentSessionId();
  }
  if (sessionId == null && sessions.length > 0) {
    sessionId = sessions[0]!.id;
    await rt.state.setCurrentSessionId(sessionId);
  }

  return { projectId, sessionId };
}

export async function handleScopeGet(): Promise<IpcResult<ScopeSnapshotDto>> {
  try {
    const rt = await getDesktopRuntime();
    const data = await loadDesktopScope(rt);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleScopeSetProject(
  req: ScopeSetProjectRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setCurrentProjectId(req.projectId);
    const sessions = await rt.sessions.listByProject(req.projectId);
    const sessionId = sessions[0]?.id;
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
  }
}
