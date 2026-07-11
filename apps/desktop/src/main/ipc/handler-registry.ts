/**
 * IPC invoke 映射表（main 侧）：channel → handler 一行注册。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc-types.js';
import { handleAppUiGet, handleAppUiSet } from './handlers/app-ui.js';
import {
  handleAgentAbort,
  handleAgentListPicker,
  handleAgentResolveCurrent,
  handleAgentRun,
  handleAgentSetCurrent,
  handleModelListPicker,
  handleModelSetCurrent,
} from './handlers/agent.js';
import { isDesktopAgentActive } from '../runtime/agent-activity.js';
import {
  handleBootstrapRebootstrap,
  handleBootstrapStatus,
} from './handlers/bootstrap.js';
import { handleCompactionManual } from './handlers/compaction.js';
import {
  handleCompactionConditionsGet,
  handleCompactionConditionsSet,
} from './handlers/compaction-conditions.js';
import {
  handleAgentRegistryCreateBlank,
  handleAgentRegistryDelete,
  handleAgentRegistryGet,
  handleAgentRegistryList,
  handleAgentRegistryUpsert,
  handleAgentYamlExport,
  handleAgentYamlImport,
} from './handlers/agent-registry.js';
import { handleBackupExport, handleBackupImport } from './handlers/backup.js';
import {
  handleCloudSyncGetConfig,
  handleCloudSyncGetLocalStatus,
  handleCloudSyncPull,
  handleCloudSyncPush,
  handleCloudSyncSetConfig,
  handleCloudSyncSetEnabled,
  handleCloudSyncTestConnection,
} from './handlers/cloud-sync.js';
import {
  handleEventsClearConfig,
  handleEventsExportYaml,
  handleEventsGetConfig,
  handleEventsImportYaml,
  handleEventsSetConfig,
} from './handlers/events.js';
import {
  handleAppCheckForUpdates,
  handleAppGetInfo,
  handleAppOpenExternal,
} from './handlers/app-info.js';
import {
  handleShellMenuPopup,
  handleShellSetTitleBarTheme,
} from './handlers/shell.js';
import {
  handlePreferencesGetLlmStream,
  handlePreferencesGetSessionFsVersionCheck,
  handlePreferencesSetLlmStream,
  handlePreferencesSetSessionFsVersionCheck,
} from './handlers/preferences.js';
import {
  handleProviderModelsDeleteSaved,
  handleProviderModelsEditSaved,
  handleProviderModelsFetch,
  handleProviderModelsGetSaved,
  handleProviderModelsResetContextWindow,
  handleProviderModelsSave,
  handleProviderModelsSavedList,
  handleProviderModelsSuggestList,
  handleProviderModelsUpdateSettings,
} from './handlers/provider-models.js';
import {
  handleProvidersCreate,
  handleProvidersDelete,
  handleProvidersEdit,
  handleProvidersGet,
  handleProvidersList,
} from './handlers/providers.js';
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
} from './handlers/regex.js';
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
  handleMessagesSetFloor,
  handleMessagesShow,
  handleMessagesShowRange,
  handleMessagesTruncateAfter,
} from './handlers/messages.js';
import {
  handlePromptAgentMeta,
  handlePromptChatTokenLabel,
  handlePromptRealPreview,
} from './handlers/prompt.js';
import {
  handleProjectsCreate,
  handleProjectsDelete,
  handleProjectsGetAgentConfig,
  handleProjectsList,
  handleProjectsPullTemplate,
  handleProjectsRename,
  handleProjectsUpdateAgentConfig,
} from './handlers/projects.js';
import {
  handleScopeGet,
  handleScopeSetProject,
  handleScopeSetSession,
} from './handlers/scope.js';
import {
  handleSessionsCreate,
  handleSessionsDelete,
  handleSessionsListByProject,
  handleSessionsPullTemplate,
  handleSessionsRename,
} from './handlers/sessions.js';
import {
  handleVfsDelete,
  handleVfsList,
  handleVfsMkdir,
  handleVfsRead,
  handleVfsRename,
  handleVfsWrite,
  handleVfsZipExport,
  handleVfsZipImport,
} from './handlers/vfs.js';
import {
  handleWorktreeBuildListRows,
  handleWorktreeGetDirRule,
  handleWorktreeInvalidateSessionSnapshot,
  handleWorktreeSetDirRule,
  handleWorktreeSetFileRule,
} from './handlers/worktree.js';

type NoArgHandler = () => unknown;
type BoolHandler = (enabled: boolean) => unknown;

function bindNoArg(channel: string, handler: NoArgHandler): void {
  ipcMain.handle(channel, () => handler());
}

/** 注册带请求体的 invoke；泛型保留各 handler 的 req 类型，避免 unknown 逆变报错。 */
function bindReq<T>(channel: string, handler: (req: T) => unknown): void {
  ipcMain.handle(channel, (_event, req) => handler(req as T));
}

function bindBool(channel: string, handler: BoolHandler): void {
  ipcMain.handle(channel, (_event, enabled: boolean) => handler(enabled));
}

function bindEventReq<T>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, req: T) => unknown,
): void {
  ipcMain.handle(channel, (event, req) => handler(event, req as T));
}

/** 按映射表注册全部 ipcMain.handle。 */
export function registerHandlersFromRegistry(): void {
  bindNoArg(IPC_CHANNELS.BOOTSTRAP_STATUS, handleBootstrapStatus);
  bindNoArg(IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP, handleBootstrapRebootstrap);

  bindNoArg(IPC_CHANNELS.SCOPE_GET, handleScopeGet);
  bindReq(IPC_CHANNELS.SCOPE_SET_PROJECT, handleScopeSetProject);
  bindReq(IPC_CHANNELS.SCOPE_SET_SESSION, handleScopeSetSession);

  bindNoArg(IPC_CHANNELS.PROJECTS_LIST, handleProjectsList);
  bindReq(IPC_CHANNELS.PROJECTS_CREATE, handleProjectsCreate);
  bindReq(IPC_CHANNELS.PROJECTS_RENAME, handleProjectsRename);
  bindReq(IPC_CHANNELS.PROJECTS_DELETE, handleProjectsDelete);
  bindReq(IPC_CHANNELS.PROJECTS_PULL_TEMPLATE, handleProjectsPullTemplate);
  bindReq(IPC_CHANNELS.PROJECTS_GET_AGENT_CONFIG, handleProjectsGetAgentConfig);
  bindReq(
    IPC_CHANNELS.PROJECTS_UPDATE_AGENT_CONFIG,
    handleProjectsUpdateAgentConfig,
  );

  bindReq(IPC_CHANNELS.SESSIONS_LIST_BY_PROJECT, handleSessionsListByProject);
  bindReq(IPC_CHANNELS.SESSIONS_CREATE, handleSessionsCreate);
  bindReq(IPC_CHANNELS.SESSIONS_RENAME, handleSessionsRename);
  bindReq(IPC_CHANNELS.SESSIONS_DELETE, handleSessionsDelete);
  bindReq(IPC_CHANNELS.SESSIONS_PULL_TEMPLATE, handleSessionsPullTemplate);

  bindReq(IPC_CHANNELS.APP_UI_GET, handleAppUiGet);
  bindReq(IPC_CHANNELS.APP_UI_SET, handleAppUiSet);

  bindReq(IPC_CHANNELS.VFS_LIST, handleVfsList);
  bindReq(IPC_CHANNELS.VFS_READ, handleVfsRead);
  bindReq(IPC_CHANNELS.VFS_WRITE, handleVfsWrite);
  bindReq(IPC_CHANNELS.VFS_MKDIR, handleVfsMkdir);
  bindReq(IPC_CHANNELS.VFS_DELETE, handleVfsDelete);
  bindReq(IPC_CHANNELS.VFS_RENAME, handleVfsRename);
  bindReq(IPC_CHANNELS.VFS_ZIP_EXPORT, handleVfsZipExport);
  bindReq(IPC_CHANNELS.VFS_ZIP_IMPORT, handleVfsZipImport);

  bindReq(IPC_CHANNELS.WORKTREE_BUILD_LIST_ROWS, handleWorktreeBuildListRows);
  bindReq(IPC_CHANNELS.WORKTREE_SET_DIR_RULE, handleWorktreeSetDirRule);
  bindReq(IPC_CHANNELS.WORKTREE_SET_FILE_RULE, handleWorktreeSetFileRule);
  bindReq(IPC_CHANNELS.WORKTREE_GET_DIR_RULE, handleWorktreeGetDirRule);
  bindReq(
    IPC_CHANNELS.WORKTREE_INVALIDATE_SESSION_SNAPSHOT,
    handleWorktreeInvalidateSessionSnapshot,
  );

  bindReq(IPC_CHANNELS.MESSAGES_LIST, handleMessagesList);
  bindReq(IPC_CHANNELS.MESSAGES_APPEND, handleMessagesAppend);
  bindReq(IPC_CHANNELS.MESSAGES_EDIT, handleMessagesEdit);
  bindReq(IPC_CHANNELS.MESSAGES_HIDE, handleMessagesHide);
  bindReq(IPC_CHANNELS.MESSAGES_SHOW, handleMessagesShow);
  bindReq(IPC_CHANNELS.MESSAGES_HIDE_RANGE, handleMessagesHideRange);
  bindReq(IPC_CHANNELS.MESSAGES_SHOW_RANGE, handleMessagesShowRange);
  bindReq(IPC_CHANNELS.MESSAGES_TRUNCATE_AFTER, handleMessagesTruncateAfter);
  bindReq(IPC_CHANNELS.MESSAGES_DELETE, handleMessagesDelete);
  bindReq(IPC_CHANNELS.MESSAGES_FORK, handleMessagesFork);
  bindReq(IPC_CHANNELS.MESSAGES_ROLLBACK, handleMessagesRollback);
  bindReq(IPC_CHANNELS.MESSAGES_SET_FLOOR, handleMessagesSetFloor);
  bindReq(
    IPC_CHANNELS.MESSAGES_APPEND_TOOL_TURN_BRIDGE,
    handleMessagesAppendToolTurnBridge,
  );

  bindReq(IPC_CHANNELS.AGENT_RUN, handleAgentRun);
  bindReq(IPC_CHANNELS.AGENT_ABORT, handleAgentAbort);
  bindNoArg(IPC_CHANNELS.AGENT_ACTIVITY_GET, () => ({
    active: isDesktopAgentActive(),
  }));
  bindNoArg(IPC_CHANNELS.AGENT_RESOLVE_CURRENT, handleAgentResolveCurrent);
  bindNoArg(IPC_CHANNELS.AGENT_LIST_PICKER, handleAgentListPicker);
  bindReq(IPC_CHANNELS.AGENT_SET_CURRENT, handleAgentSetCurrent);
  bindNoArg(IPC_CHANNELS.MODEL_LIST_PICKER, handleModelListPicker);
  bindReq(IPC_CHANNELS.MODEL_SET_CURRENT, handleModelSetCurrent);

  bindReq(IPC_CHANNELS.PROMPT_REAL_PREVIEW, handlePromptRealPreview);
  bindReq(IPC_CHANNELS.PROMPT_CHAT_TOKEN_LABEL, handlePromptChatTokenLabel);
  bindReq(IPC_CHANNELS.PROMPT_AGENT_META, handlePromptAgentMeta);

  bindReq(IPC_CHANNELS.COMPACTION_MANUAL, handleCompactionManual);

  bindNoArg(
    IPC_CHANNELS.PREFERENCES_GET_SESSION_FS_VERSION_CHECK,
    handlePreferencesGetSessionFsVersionCheck,
  );
  bindBool(
    IPC_CHANNELS.PREFERENCES_SET_SESSION_FS_VERSION_CHECK,
    handlePreferencesSetSessionFsVersionCheck,
  );
  bindNoArg(
    IPC_CHANNELS.PREFERENCES_GET_LLM_STREAM,
    handlePreferencesGetLlmStream,
  );
  bindBool(
    IPC_CHANNELS.PREFERENCES_SET_LLM_STREAM,
    handlePreferencesSetLlmStream,
  );

  bindNoArg(IPC_CHANNELS.PROVIDERS_LIST, handleProvidersList);
  bindReq(IPC_CHANNELS.PROVIDERS_GET, handleProvidersGet);
  bindReq(IPC_CHANNELS.PROVIDERS_CREATE, handleProvidersCreate);
  bindReq(IPC_CHANNELS.PROVIDERS_EDIT, handleProvidersEdit);
  bindReq(IPC_CHANNELS.PROVIDERS_DELETE, handleProvidersDelete);

  bindReq(
    IPC_CHANNELS.PROVIDER_MODELS_SAVED_LIST,
    handleProviderModelsSavedList,
  );
  bindReq(IPC_CHANNELS.PROVIDER_MODELS_FETCH, handleProviderModelsFetch);
  bindReq(
    IPC_CHANNELS.PROVIDER_MODELS_SUGGEST_LIST,
    handleProviderModelsSuggestList,
  );
  bindReq(IPC_CHANNELS.PROVIDER_MODELS_SAVE, handleProviderModelsSave);
  bindReq(
    IPC_CHANNELS.PROVIDER_MODELS_DELETE_SAVED,
    handleProviderModelsDeleteSaved,
  );
  bindReq(IPC_CHANNELS.PROVIDER_MODELS_GET_SAVED, handleProviderModelsGetSaved);
  bindReq(
    IPC_CHANNELS.PROVIDER_MODELS_UPDATE_SETTINGS,
    handleProviderModelsUpdateSettings,
  );
  bindReq(
    IPC_CHANNELS.PROVIDER_MODELS_RESET_CONTEXT_WINDOW,
    handleProviderModelsResetContextWindow,
  );
  bindReq(
    IPC_CHANNELS.PROVIDER_MODELS_EDIT_SAVED,
    handleProviderModelsEditSaved,
  );

  bindNoArg(IPC_CHANNELS.AGENT_REGISTRY_LIST, handleAgentRegistryList);
  bindReq(IPC_CHANNELS.AGENT_REGISTRY_GET, handleAgentRegistryGet);
  bindReq(IPC_CHANNELS.AGENT_REGISTRY_UPSERT, handleAgentRegistryUpsert);
  bindReq(IPC_CHANNELS.AGENT_REGISTRY_DELETE, handleAgentRegistryDelete);
  bindNoArg(
    IPC_CHANNELS.AGENT_REGISTRY_CREATE_BLANK,
    handleAgentRegistryCreateBlank,
  );
  bindReq(IPC_CHANNELS.AGENT_YAML_EXPORT, handleAgentYamlExport);
  bindReq(IPC_CHANNELS.AGENT_YAML_IMPORT, handleAgentYamlImport);

  bindNoArg(IPC_CHANNELS.REGEX_LIST_GROUPS, handleRegexListGroups);
  bindReq(IPC_CHANNELS.REGEX_GET_GROUP, handleRegexGetGroup);
  bindReq(IPC_CHANNELS.REGEX_CREATE_GROUP, handleRegexCreateGroup);
  bindReq(IPC_CHANNELS.REGEX_UPDATE_GROUP, handleRegexUpdateGroup);
  bindReq(IPC_CHANNELS.REGEX_DELETE_GROUP, handleRegexDeleteGroup);
  bindReq(IPC_CHANNELS.REGEX_LIST_RULES, handleRegexListRules);
  bindReq(IPC_CHANNELS.REGEX_GET_RULE, handleRegexGetRule);
  bindReq(IPC_CHANNELS.REGEX_CREATE_RULE, handleRegexCreateRule);
  bindReq(IPC_CHANNELS.REGEX_UPDATE_RULE, handleRegexUpdateRule);
  bindReq(IPC_CHANNELS.REGEX_DELETE_RULE, handleRegexDeleteRule);
  bindNoArg(IPC_CHANNELS.REGEX_LIST_PICKER, handleRegexListPicker);
  bindReq(IPC_CHANNELS.REGEX_SET_CURRENT, handleRegexSetCurrent);

  bindNoArg(IPC_CHANNELS.EVENTS_GET_CONFIG, handleEventsGetConfig);
  bindReq(IPC_CHANNELS.EVENTS_SET_CONFIG, handleEventsSetConfig);
  bindNoArg(IPC_CHANNELS.EVENTS_CLEAR_CONFIG, handleEventsClearConfig);
  bindNoArg(IPC_CHANNELS.EVENTS_EXPORT_YAML, handleEventsExportYaml);
  bindNoArg(IPC_CHANNELS.EVENTS_IMPORT_YAML, handleEventsImportYaml);

  bindNoArg(
    IPC_CHANNELS.COMPACTION_CONDITIONS_GET,
    handleCompactionConditionsGet,
  );
  bindReq(
    IPC_CHANNELS.COMPACTION_CONDITIONS_SET,
    handleCompactionConditionsSet,
  );

  bindNoArg(IPC_CHANNELS.BACKUP_EXPORT, handleBackupExport);
  bindNoArg(IPC_CHANNELS.BACKUP_IMPORT, handleBackupImport);

  bindNoArg(IPC_CHANNELS.CLOUD_SYNC_GET_CONFIG, handleCloudSyncGetConfig);
  bindReq(IPC_CHANNELS.CLOUD_SYNC_SET_CONFIG, handleCloudSyncSetConfig);
  bindBool(IPC_CHANNELS.CLOUD_SYNC_SET_ENABLED, handleCloudSyncSetEnabled);
  bindNoArg(
    IPC_CHANNELS.CLOUD_SYNC_TEST_CONNECTION,
    handleCloudSyncTestConnection,
  );
  bindNoArg(
    IPC_CHANNELS.CLOUD_SYNC_GET_LOCAL_STATUS,
    handleCloudSyncGetLocalStatus,
  );
  bindNoArg(IPC_CHANNELS.CLOUD_SYNC_PULL, handleCloudSyncPull);
  bindReq(IPC_CHANNELS.CLOUD_SYNC_PUSH, handleCloudSyncPush);

  bindEventReq(IPC_CHANNELS.SHELL_MENU_POPUP, handleShellMenuPopup);
  bindEventReq(
    IPC_CHANNELS.SHELL_SET_TITLEBAR_THEME,
    handleShellSetTitleBarTheme,
  );
  bindReq(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, handleAppOpenExternal);

  bindNoArg(IPC_CHANNELS.APP_GET_INFO, handleAppGetInfo);
  bindNoArg(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, handleAppCheckForUpdates);
}
