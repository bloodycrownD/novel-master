/**
 * Registers typed ipcMain handlers for all desktop domains.
 */
import { ipcMain } from "electron";
import { IPC_CHANNELS, type PromptScopeRequest } from "../../../shared/ipc-types.js";
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
import { handleCompactionConditionsGet, handleCompactionConditionsSet } from "./handlers/compaction-conditions.js";
import {
  handleAgentRegistryCreateBlank,
  handleAgentRegistryDelete,
  handleAgentRegistryGet,
  handleAgentRegistryList,
  handleAgentRegistryUpsert,
  handleAgentYamlExport,
  handleAgentYamlImport,
} from "./handlers/agent-registry.js";
import {
  handleBackupExport,
  handleBackupImport,
} from "./handlers/backup.js";
import {
  handleCloudSyncGetConfig,
  handleCloudSyncGetLocalStatus,
  handleCloudSyncPull,
  handleCloudSyncPush,
  handleCloudSyncSetConfig,
  handleCloudSyncSetEnabled,
  handleCloudSyncTestConnection,
} from "./handlers/cloud-sync.js";
import {
  handleEventsClearConfig,
  handleEventsExportYaml,
  handleEventsGetConfig,
  handleEventsImportYaml,
  handleEventsSetConfig,
} from "./handlers/events.js";
import {
  handleAppCheckForUpdates,
  handleAppGetInfo,
  handleAppOpenExternal,
} from "./handlers/app-info.js";
import {
  handleShellMenuPopup,
  handleShellSetTitleBarTheme,
} from "./handlers/shell.js";
import {
  handlePreferencesGetLlmStream,
  handlePreferencesGetSessionFsVersionCheck,
  handlePreferencesSetLlmStream,
  handlePreferencesSetSessionFsVersionCheck,
} from "./handlers/preferences.js";
import {
  handleProviderModelsDeleteSaved,
  handleProviderModelsFetch,
  handleProviderModelsGetSaved,
  handleProviderModelsResetContextWindow,
  handleProviderModelsSave,
  handleProviderModelsSavedList,
  handleProviderModelsSuggestList,
  handleProviderModelsUpdateSettings,
} from "./handlers/provider-models.js";
import {
  handleProvidersCreate,
  handleProvidersDelete,
  handleProvidersEdit,
  handleProvidersGet,
  handleProvidersList,
} from "./handlers/providers.js";
import {
  handleRegexCreateGroup,
  handleRegexCreateRule,
  handleRegexDeleteGroup,
  handleRegexDeleteRule,
  handleRegexGetGroup,
  handleRegexGetRule,
  handleRegexListGroups,
  handleRegexListPicker,
  handleRegexListRules,
  handleRegexSetCurrent,
  handleRegexUpdateGroup,
  handleRegexUpdateRule,
} from "./handlers/regex.js";
import {
  handleMessagesAppend,
  handleMessagesAppendToolTurnBridge,
  handleMessagesDelete,
  handleMessagesEdit,
  handleMessagesFork,
  handleMessagesHide,
  handleMessagesHideRange,
  handleMessagesList,
  handleMessagesRollback,
  handleMessagesShow,
  handleMessagesShowRange,
  handleMessagesTruncateAfter,
} from "./handlers/messages.js";
import {
  handlePromptAgentMeta,
  handlePromptChatTokenLabel,
  handlePromptRealPreview,
} from "./handlers/prompt.js";
import {
  handleProjectsCreate,
  handleProjectsDelete,
  handleProjectsGetAgentConfig,
  handleProjectsList,
  handleProjectsPullTemplate,
  handleProjectsRename,
  handleProjectsUpdateAgentConfig,
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
  handleWorktreeInvalidateSessionSnapshot,
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
  ipcMain.handle(IPC_CHANNELS.PROJECTS_GET_AGENT_CONFIG, (_event, req) =>
    handleProjectsGetAgentConfig(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROJECTS_UPDATE_AGENT_CONFIG, (_event, req) =>
    handleProjectsUpdateAgentConfig(req),
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
  ipcMain.handle(IPC_CHANNELS.WORKTREE_INVALIDATE_SESSION_SNAPSHOT, (_event, req) =>
    handleWorktreeInvalidateSessionSnapshot(req),
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
  ipcMain.handle(IPC_CHANNELS.MESSAGES_SHOW, (_event, req) =>
    handleMessagesShow(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_HIDE_RANGE, (_event, req) =>
    handleMessagesHideRange(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_SHOW_RANGE, (_event, req) =>
    handleMessagesShowRange(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_TRUNCATE_AFTER, (_event, req) =>
    handleMessagesTruncateAfter(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_DELETE, (_event, req) =>
    handleMessagesDelete(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_FORK, (_event, req) =>
    handleMessagesFork(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_ROLLBACK, (_event, req) =>
    handleMessagesRollback(req),
  );
  ipcMain.handle(IPC_CHANNELS.MESSAGES_APPEND_TOOL_TURN_BRIDGE, (_event, req) =>
    handleMessagesAppendToolTurnBridge(req),
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
  ipcMain.handle(IPC_CHANNELS.PROMPT_AGENT_META, (_event, req: PromptScopeRequest) =>
    handlePromptAgentMeta(req),
  );

  ipcMain.handle(IPC_CHANNELS.COMPACTION_MANUAL, (_event, req) =>
    handleCompactionManual(req),
  );

  ipcMain.handle(IPC_CHANNELS.PREFERENCES_GET_SESSION_FS_VERSION_CHECK, () =>
    handlePreferencesGetSessionFsVersionCheck(),
  );
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES_SET_SESSION_FS_VERSION_CHECK,
    (_event, enabled: boolean) =>
      handlePreferencesSetSessionFsVersionCheck(enabled),
  );
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_GET_LLM_STREAM, () =>
    handlePreferencesGetLlmStream(),
  );
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES_SET_LLM_STREAM,
    (_event, enabled: boolean) => handlePreferencesSetLlmStream(enabled),
  );

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_LIST, () => handleProvidersList());
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_GET, (_event, req) =>
    handleProvidersGet(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_CREATE, (_event, req) =>
    handleProvidersCreate(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_EDIT, (_event, req) =>
    handleProvidersEdit(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_DELETE, (_event, req) =>
    handleProvidersDelete(req),
  );

  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_SAVED_LIST, (_event, req) =>
    handleProviderModelsSavedList(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_FETCH, (_event, req) =>
    handleProviderModelsFetch(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_SUGGEST_LIST, (_event, req) =>
    handleProviderModelsSuggestList(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_SAVE, (_event, req) =>
    handleProviderModelsSave(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_DELETE_SAVED, (_event, req) =>
    handleProviderModelsDeleteSaved(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_GET_SAVED, (_event, req) =>
    handleProviderModelsGetSaved(req),
  );
  ipcMain.handle(IPC_CHANNELS.PROVIDER_MODELS_UPDATE_SETTINGS, (_event, req) =>
    handleProviderModelsUpdateSettings(req),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROVIDER_MODELS_RESET_CONTEXT_WINDOW,
    (_event, req) => handleProviderModelsResetContextWindow(req),
  );

  ipcMain.handle(IPC_CHANNELS.AGENT_REGISTRY_LIST, () =>
    handleAgentRegistryList(),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_REGISTRY_GET, (_event, req) =>
    handleAgentRegistryGet(req),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_REGISTRY_UPSERT, (_event, req) =>
    handleAgentRegistryUpsert(req),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_REGISTRY_DELETE, (_event, req) =>
    handleAgentRegistryDelete(req),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_REGISTRY_CREATE_BLANK, () =>
    handleAgentRegistryCreateBlank(),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_YAML_EXPORT, (_event, req) =>
    handleAgentYamlExport(req),
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_YAML_IMPORT, (_event, req) =>
    handleAgentYamlImport(req),
  );

  ipcMain.handle(IPC_CHANNELS.REGEX_LIST_GROUPS, () => handleRegexListGroups());
  ipcMain.handle(IPC_CHANNELS.REGEX_GET_GROUP, (_event, req) =>
    handleRegexGetGroup(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_CREATE_GROUP, (_event, req) =>
    handleRegexCreateGroup(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_UPDATE_GROUP, (_event, req) =>
    handleRegexUpdateGroup(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_DELETE_GROUP, (_event, req) =>
    handleRegexDeleteGroup(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_LIST_RULES, (_event, req) =>
    handleRegexListRules(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_GET_RULE, (_event, req) =>
    handleRegexGetRule(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_CREATE_RULE, (_event, req) =>
    handleRegexCreateRule(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_UPDATE_RULE, (_event, req) =>
    handleRegexUpdateRule(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_DELETE_RULE, (_event, req) =>
    handleRegexDeleteRule(req),
  );
  ipcMain.handle(IPC_CHANNELS.REGEX_LIST_PICKER, () => handleRegexListPicker());
  ipcMain.handle(IPC_CHANNELS.REGEX_SET_CURRENT, (_event, req) =>
    handleRegexSetCurrent(req),
  );

  ipcMain.handle(IPC_CHANNELS.EVENTS_GET_CONFIG, () => handleEventsGetConfig());
  ipcMain.handle(IPC_CHANNELS.EVENTS_SET_CONFIG, (_event, req) =>
    handleEventsSetConfig(req),
  );
  ipcMain.handle(IPC_CHANNELS.EVENTS_CLEAR_CONFIG, () =>
    handleEventsClearConfig(),
  );
  ipcMain.handle(IPC_CHANNELS.EVENTS_EXPORT_YAML, () => handleEventsExportYaml());
  ipcMain.handle(IPC_CHANNELS.EVENTS_IMPORT_YAML, () => handleEventsImportYaml());

  ipcMain.handle(IPC_CHANNELS.COMPACTION_CONDITIONS_GET, () =>
    handleCompactionConditionsGet(),
  );
  ipcMain.handle(IPC_CHANNELS.COMPACTION_CONDITIONS_SET, (_event, req) =>
    handleCompactionConditionsSet(req),
  );

  ipcMain.handle(IPC_CHANNELS.BACKUP_EXPORT, () => handleBackupExport());
  ipcMain.handle(IPC_CHANNELS.BACKUP_IMPORT, () => handleBackupImport());

  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_GET_CONFIG, () =>
    handleCloudSyncGetConfig(),
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_SET_CONFIG, (_event, req) =>
    handleCloudSyncSetConfig(req),
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_SET_ENABLED, (_event, enabled: boolean) =>
    handleCloudSyncSetEnabled(enabled),
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_TEST_CONNECTION, () =>
    handleCloudSyncTestConnection(),
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_GET_LOCAL_STATUS, () =>
    handleCloudSyncGetLocalStatus(),
  );
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_PULL, () => handleCloudSyncPull());
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC_PUSH, (_event, req) =>
    handleCloudSyncPush(req),
  );

  ipcMain.handle(IPC_CHANNELS.SHELL_MENU_POPUP, (event, req) =>
    handleShellMenuPopup(event, req),
  );
  ipcMain.handle(IPC_CHANNELS.SHELL_SET_TITLEBAR_THEME, (event, theme) =>
    handleShellSetTitleBarTheme(event, theme),
  );
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, (_event, req) =>
    handleAppOpenExternal(req),
  );

  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, () => handleAppGetInfo());
  ipcMain.handle(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, () =>
    handleAppCheckForUpdates(),
  );
}
