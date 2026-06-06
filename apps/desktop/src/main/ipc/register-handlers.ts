/**
 * Registers typed ipcMain handlers for all desktop domains.
 */
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-types.js";
import { handleAppUiGet, handleAppUiSet } from "./handlers/app-ui.js";
import {
  handleBootstrapRebootstrap,
  handleBootstrapStatus,
} from "./handlers/bootstrap.js";
import {
  handleProjectsCreate,
  handleProjectsDelete,
  handleProjectsList,
  handleProjectsRename,
} from "./handlers/projects.js";
import {
  handleScopeGet,
  handleScopeSetProject,
  handleScopeSetSession,
} from "./handlers/scope.js";
import {
  handleSessionsCreate,
  handleSessionsDelete,
  handleSessionsListByProject,
  handleSessionsRename,
} from "./handlers/sessions.js";

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BOOTSTRAP_STATUS, () => handleBootstrapStatus());
  ipcMain.handle(IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP, () =>
    handleBootstrapRebootstrap(),
  );

  ipcMain.handle(IPC_CHANNELS.SCOPE_GET, () => handleScopeGet());
  ipcMain.handle(IPC_CHANNELS.SCOPE_SET_PROJECT, (_event, req) =>
    handleScopeSetProject(req),
  );
  ipcMain.handle(IPC_CHANNELS.SCOPE_SET_SESSION, (_event, req) =>
    handleScopeSetSession(req),
  );

  ipcMain.handle(IPC_CHANNELS.PROJECTS_LIST, () => handleProjectsList());
  ipcMain.handle(IPC_CHANNELS.PROJECTS_CREATE, (_event, req) =>
    handleProjectsCreate(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROJECTS_RENAME, (_event, req) =>
    handleProjectsRename(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROJECTS_DELETE, (_event, req) =>
    handleProjectsDelete(req),
  );

  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST_BY_PROJECT, (_event, req) =>
    handleSessionsListByProject(req),
  );
  ipcMain.handle(IPC_CHANNELS.SESSIONS_CREATE, (_event, req) =>
    handleSessionsCreate(req),
  );
  ipcMain.handle(IPC_CHANNELS.SESSIONS_RENAME, (_event, req) =>
    handleSessionsRename(req),
  );
  ipcMain.handle(IPC_CHANNELS.SESSIONS_DELETE, (_event, req) =>
    handleSessionsDelete(req),
  );

  ipcMain.handle(IPC_CHANNELS.APP_UI_GET, (_event, req) => handleAppUiGet(req));
  ipcMain.handle(IPC_CHANNELS.APP_UI_SET, (_event, req) => handleAppUiSet(req));
}
