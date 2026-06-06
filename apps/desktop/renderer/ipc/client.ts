/**
 * Renderer-side IPC client — thin wrapper over preload bridge.
 */
import {
  IPC_CHANNELS,
  type AppUiGetResponse,
  type BootstrapStatusResponse,
  type IpcResult,
  type ProjectCreateRequest,
  type ProjectDeleteRequest,
  type ProjectDto,
  type ProjectRenameRequest,
  type ScopeSetProjectRequest,
  type ScopeSetSessionRequest,
  type ScopeSnapshotDto,
  type SessionCreateRequest,
  type SessionDeleteRequest,
  type SessionDto,
  type SessionListByProjectRequest,
  type SessionRenameRequest,
} from "../../shared/ipc-types.js";

function bridge() {
  if (!window.novelMasterDesktop) {
    throw new Error("novelMasterDesktop preload bridge is unavailable");
  }
  return window.novelMasterDesktop;
}

export async function getBootstrapStatus(): Promise<BootstrapStatusResponse> {
  return bridge().invoke<BootstrapStatusResponse>(IPC_CHANNELS.BOOTSTRAP_STATUS);
}

export async function rebootstrap(): Promise<BootstrapStatusResponse> {
  return bridge().invoke<BootstrapStatusResponse>(
    IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP,
  );
}

export function onAgentStream(
  callback: (payload: unknown) => void,
): () => void {
  return bridge().on(IPC_CHANNELS.AGENT_STREAM, callback);
}

export async function ipcScopeGet(): Promise<IpcResult<ScopeSnapshotDto>> {
  return bridge().invoke<IpcResult<ScopeSnapshotDto>>(IPC_CHANNELS.SCOPE_GET);
}

export async function ipcScopeSetProject(
  req: ScopeSetProjectRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  return bridge().invoke<IpcResult<ScopeSnapshotDto>>(
    IPC_CHANNELS.SCOPE_SET_PROJECT,
    req,
  );
}

export async function ipcScopeSetSession(
  req: ScopeSetSessionRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  return bridge().invoke<IpcResult<ScopeSnapshotDto>>(
    IPC_CHANNELS.SCOPE_SET_SESSION,
    req,
  );
}

export async function ipcProjectsList(): Promise<IpcResult<ProjectDto[]>> {
  return bridge().invoke<IpcResult<ProjectDto[]>>(IPC_CHANNELS.PROJECTS_LIST);
}

export async function ipcProjectsCreate(
  req: ProjectCreateRequest,
): Promise<IpcResult<ProjectDto>> {
  return bridge().invoke<IpcResult<ProjectDto>>(
    IPC_CHANNELS.PROJECTS_CREATE,
    req,
  );
}

export async function ipcProjectsRename(
  req: ProjectRenameRequest,
): Promise<IpcResult<ProjectDto>> {
  return bridge().invoke<IpcResult<ProjectDto>>(
    IPC_CHANNELS.PROJECTS_RENAME,
    req,
  );
}

export async function ipcProjectsDelete(
  req: ProjectDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke<IpcResult<void>>(IPC_CHANNELS.PROJECTS_DELETE, req);
}

export async function ipcSessionsListByProject(
  req: SessionListByProjectRequest,
): Promise<IpcResult<SessionDto[]>> {
  return bridge().invoke<IpcResult<SessionDto[]>>(
    IPC_CHANNELS.SESSIONS_LIST_BY_PROJECT,
    req,
  );
}

export async function ipcSessionsCreate(
  req: SessionCreateRequest,
): Promise<IpcResult<SessionDto>> {
  return bridge().invoke<IpcResult<SessionDto>>(
    IPC_CHANNELS.SESSIONS_CREATE,
    req,
  );
}

export async function ipcSessionsRename(
  req: SessionRenameRequest,
): Promise<IpcResult<SessionDto>> {
  return bridge().invoke<IpcResult<SessionDto>>(
    IPC_CHANNELS.SESSIONS_RENAME,
    req,
  );
}

export async function ipcSessionsDelete(
  req: SessionDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke<IpcResult<void>>(IPC_CHANNELS.SESSIONS_DELETE, req);
}

export async function ipcAppUiGet(key: string): Promise<AppUiGetResponse> {
  return bridge().invoke<AppUiGetResponse>(IPC_CHANNELS.APP_UI_GET, { key });
}

export async function ipcAppUiSet(
  key: string,
  value: string,
): Promise<IpcResult<void>> {
  return bridge().invoke<IpcResult<void>>(IPC_CHANNELS.APP_UI_SET, {
    key,
    value,
  });
}
