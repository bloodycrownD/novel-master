/**
 * IPC channel names and serializable DTOs shared by main, preload, and renderer.
 * Single source of truth — handlers must not invent ad-hoc channel strings.
 */

export const IPC_CHANNELS = {
  BOOTSTRAP_STATUS: "nm:bootstrap/status",
  BOOTSTRAP_REBOOTSTRAP: "nm:bootstrap/rebootstrap",
  EVENT_BUS: "nm:event-bus",
  AGENT_STREAM: "nm:agent-stream",

  SCOPE_GET: "nm:scope/get",
  SCOPE_SET_PROJECT: "nm:scope/setProject",
  SCOPE_SET_SESSION: "nm:scope/setSession",

  PROJECTS_LIST: "nm:projects/list",
  PROJECTS_CREATE: "nm:projects/create",
  PROJECTS_RENAME: "nm:projects/rename",
  PROJECTS_DELETE: "nm:projects/delete",

  SESSIONS_LIST_BY_PROJECT: "nm:sessions/listByProject",
  SESSIONS_CREATE: "nm:sessions/create",
  SESSIONS_RENAME: "nm:sessions/rename",
  SESSIONS_DELETE: "nm:sessions/delete",

  APP_UI_GET: "nm:app-ui/get",
  APP_UI_SET: "nm:app-ui/set",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type IpcErrorPayload = {
  readonly code: string;
  readonly message: string;
};

export type IpcResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: IpcErrorPayload };

export type BootstrapStatusReady = {
  readonly ok: true;
  readonly status: "ready";
  readonly dbPath: string;
};

export type BootstrapStatusFailed = {
  readonly ok: false;
  readonly error: IpcErrorPayload;
};

export type BootstrapStatusResponse =
  | BootstrapStatusReady
  | BootstrapStatusFailed;

export type BootstrapRebootstrapResponse = BootstrapStatusResponse;

/** Serializable project row for renderer lists. */
export type ProjectDto = {
  readonly id: string;
  readonly name: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

/** Serializable session row for renderer lists. */
export type SessionDto = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type ScopeSnapshotDto = {
  readonly projectId: string | undefined;
  readonly sessionId: string | undefined;
};

export type ScopeSetProjectRequest = {
  readonly projectId: string;
};

export type ScopeSetSessionRequest = {
  readonly projectId: string;
  readonly sessionId: string;
};

export type ProjectCreateRequest = {
  readonly name: string;
};

export type ProjectRenameRequest = {
  readonly id: string;
  readonly name: string;
};

export type ProjectDeleteRequest = {
  readonly id: string;
};

export type SessionListByProjectRequest = {
  readonly projectId: string;
};

export type SessionCreateRequest = {
  readonly projectId: string;
  readonly title?: string | null;
};

export type SessionRenameRequest = {
  readonly id: string;
  readonly title: string;
};

export type SessionDeleteRequest = {
  readonly id: string;
};

export type AppUiGetRequest = {
  readonly key: string;
};

export type AppUiSetRequest = {
  readonly key: string;
  readonly value: string;
};

export type AppUiGetResponse = IpcResult<string | undefined>;
