/**
 * Registers typed ipcMain handlers for all desktop domains.
 */
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-types.js";
import { handleAppUiGet, handleAppUiSet } from "./handlers/app-ui.js";
import {
  handleAgentAbort,
  handleAgentListPicker,
  handleAgentResolveCurrent,
  handleAgentRun,
  handleAgentSetCurrent,
  handleModelListPicker,
  handleModelSetCurrent,
} from "./handlers/agent.js";
import {
  handleBootstrapRebootstrap,
  handleBootstrapStatus,
} from "./handlers/bootstrap.js";
import { handleCompactionManual } from "./handlers/compaction.js";
import {
  handleMessagesAppend,
  handleMessagesDelete,
  handleMessagesEdit,
  handleMessagesHide,
  handleMessagesList,
  handleMessagesRollback,
} from "./handlers/messages.js";
import {
  handlePromptAgentMeta,
  handlePromptChatTokenLabel,
  handlePromptRealPreview,
} from "./handlers/prompt.js";
import {
  handleProjectsCreate,
  handleProjectsDelete,
  handleProjectsList,
  handleProjectsPullTemplate,
  handleProjectsRename,
} from "./handlers/projects.js";
import {
  handleScopeGet,
  handleScopeSetProject,
  handleScopeSetSession,
} from "./handlers/scope.js";
import {
  handleSessionFsExecute,
  handleSessionFsListBatches,
  handleSessionFsRollback,
} from "./handlers/session-fs.js";
import {
  handleSessionsCreate,
  handleSessionsDelete,
  handleSessionsListByProject,
  handleSessionsPullTemplate,
  handleSessionsRename,
} from "./handlers/sessions.js";
import {
  handleVfsDelete,
  handleVfsList,
  handleVfsMkdir,
  handleVfsRead,
  handleVfsRename,
  handleVfsWrite,
  handleVfsZipExport,
  handleVfsZipImport,
} from "./handlers/vfs.js";
import {
  handleWorktreeBuildListRows,
  handleWorktreeGetDirRule,
  handleWorktreeSetDirRule,
  handleWorktreeSetFileRule,
} from "./handlers/worktree.js";

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
  ipcMain.handle(IPC_CHANNELS.PROJECTS_PULL_TEMPLATE, (_event, req) =>
    handleProjectsPullTemplate(req),
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
  ipcMain.handle(IPC_CHANNELS.SESSIONS_PULL_TEMPLATE, (_event, req) =>
    handleSessionsPullTemplate(req),
  );

  ipcMain.handle(IPC_CHANNELS.APP_UI_GET, (_event, req) => handleAppUiGet(req));
  ipcMain.handle(IPC_CHANNELS.APP_UI_SET, (_event, req) => handleAppUiSet(req));

  ipcMain.handle(IPC_CHANNELS.VFS_LIST, (_event, req) => handleVfsList(req));
  ipcMain.handle(IPC_CHANNELS.VFS_READ, (_event, req) => handleVfsRead(req));
  ipcMain.handle(IPC_CHANNELS.VFS_WRITE, (_event, req) => handleVfsWrite(req));
  ipcMain.handle(IPC_CHANNELS.VFS_MKDIR, (_event, req) => handleVfsMkdir(req));
  ipcMain.handle(IPC_CHANNELS.VFS_DELETE, (_event, req) =>
    handleVfsDelete(req),
  );
  ipcMain.handle(IPC_CHANNELS.VFS_RENAME, (_event, req) =>
    handleVfsRename(req),
  );
  ipcMain.handle(IPC_CHANNELS.VFS_ZIP_EXPORT, (_event, req) =>
    handleVfsZipExport(req),
  );
  ipcMain.handle(IPC_CHANNELS.VFS_ZIP_IMPORT, (_event, req) =>
    handleVfsZipImport(req),
  );

  ipcMain.handle(IPC_CHANNELS.WORKTREE_BUILD_LIST_ROWS, (_event, req) =>
    handleWorktreeBuildListRows(req),
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE_SET_DIR_RULE, (_event, req) =>
    handleWorktreeSetDirRule(req),
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE_SET_FILE_RULE, (_event, req) =>
    handleWorktreeSetFileRule(req),
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE_GET_DIR_RULE, (_event, req) =>
    handleWorktreeGetDirRule(req),
  );

  ipcMain.handle(IPC_CHANNELS.SESSION_FS_EXECUTE, (_event, req) =>
    handleSessionFsExecute(req),
  );
  ipcMain.handle(IPC_CHANNELS.SESSION_FS_LIST_BATCHES, (_event, req) =>
    handleSessionFsListBatches(req),
  );
  ipcMain.handle(IPC_CHANNELS.SESSION_FS_ROLLBACK, (_event, req) =>
    handleSessionFsRollback(req),
  );

  ipcMain.handle(IPC_CHANNELS.MESSAGES_LIST, (_event, req) =>
    handleMessagesList(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_APPEND, (_event, req) =>
    handleMessagesAppend(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_EDIT, (_event, req) =>
    handleMessagesEdit(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_HIDE, (_event, req) =>
    handleMessagesHide(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_DELETE, (_event, req) =>
    handleMessagesDelete(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_ROLLBACK, (_event, req) =>
    handleMessagesRollback(req),
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_RUN, (_event, req) => handleAgentRun(req));
  ipcMain.handle(IPC_CHANNELS.AGENT_ABORT, (_event, req) =>
    handleAgentAbort(req),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_RESOLVE_CURRENT, () =>
    handleAgentResolveCurrent(),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_LIST_PICKER, () =>
    handleAgentListPicker(),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_SET_CURRENT, (_event, req) =>
    handleAgentSetCurrent(req),
  );
  ipcMain.handle(IPC_CHANNELS.MODEL_LIST_PICKER, () => handleModelListPicker());
  ipcMain.handle(IPC_CHANNELS.MODEL_SET_CURRENT, (_event, req) =>
    handleModelSetCurrent(req),
  );

  ipcMain.handle(IPC_CHANNELS.PROMPT_REAL_PREVIEW, (_event, req) =>
    handlePromptRealPreview(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_CHAT_TOKEN_LABEL, (_event, req) =>
    handlePromptChatTokenLabel(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROMPT_AGENT_META, () => handlePromptAgentMeta());

  ipcMain.handle(IPC_CHANNELS.COMPACTION_MANUAL, (_event, req) =>
    handleCompactionManual(req),
  );
}
