/**
 * Renderer-side IPC client — thin wrapper over preload bridge.
 */
import {
  IPC_CHANNELS,
  type AgentStreamEventPayload,
  type AgentActivityPayload,
  type VfsScopeRequest,
  type WorkspaceMutatedPayload,
  type ComposerAttachmentsSuggestPayload,
} from '@shared/ipc-types';
import { createInvokeClient } from './invoke-registry';

function bridge() {
  if (!window.novelMasterDesktop) {
    const inBrowser =
      typeof navigator !== 'undefined' &&
      !/Electron/i.test(navigator.userAgent);
    throw new Error(
      inBrowser
        ? 'novelMasterDesktop 仅在 Electron 中可用。请运行 npm run desktop:dev，不要直接在浏览器打开 localhost:5173。'
        : 'novelMasterDesktop preload bridge is unavailable（preload 未加载，请重新 build 后启动 Electron）',
    );
  }
  return window.novelMasterDesktop;
}

export function getDesktopBridge() {
  return bridge();
}

const invokeClient = createInvokeClient((channel, arg) =>
  bridge().invoke(channel, arg),
);

export const {
  getBootstrapStatus,
  rebootstrap,
  ipcAgentActivityGet,
  ipcScopeGet,
  ipcScopeSetProject,
  ipcScopeSetSession,
  ipcProjectsList,
  ipcProjectsCreate,
  ipcProjectsRename,
  ipcProjectsDelete,
  ipcProjectsGetAgentConfig,
  ipcProjectsUpdateAgentConfig,
  ipcSessionsListByProject,
  ipcSessionsCreate,
  ipcSessionsRename,
  ipcSessionsDelete,
  ipcAppUiGet,
  ipcAppUiSet,
  ipcWorktreeBuildListRows,
  ipcWorktreeSetDirRule,
  ipcWorktreeSetFileRule,
  ipcWorktreeGetDirRule,
  ipcWorktreeCaptureSessionBlock,
  ipcVfsRead,
  ipcVfsWrite,
  ipcVfsMkdir,
  ipcVfsDelete,
  ipcVfsRename,
  ipcVfsZipExport,
  ipcVfsZipImport,
  ipcProjectsPullTemplate,
  ipcSessionsPullTemplate,
  ipcMessagesList,
  ipcMessagesAppend,
  ipcMessagesAppendToolTurnBridge,
  ipcMessagesEdit,
  ipcMessagesHide,
  ipcMessagesShow,
  ipcMessagesHideRange,
  ipcMessagesShowRange,
  ipcMessagesTruncateAfter,
  ipcMessagesDelete,
  ipcMessagesFork,
  ipcMessagesRollback,
  ipcMessagesSetFloor,
  ipcAgentRun,
  ipcAgentAbort,
  ipcAgentResolveCurrent,
  ipcAgentListPicker,
  ipcAgentSetCurrent,
  ipcModelListPicker,
  ipcModelSetCurrent,
  ipcPromptRealPreview,
  ipcPromptChatTokenLabel,
  ipcPromptAgentMeta,
  ipcCompactionManual,
  ipcPreferencesGetSessionFsVersionCheck,
  ipcPreferencesSetSessionFsVersionCheck,
  ipcPreferencesGetLlmStream,
  ipcPreferencesSetLlmStream,
  ipcProvidersList,
  ipcProvidersGet,
  ipcProvidersCreate,
  ipcProvidersEdit,
  ipcProvidersDelete,
  ipcProviderModelsSavedList,
  ipcProviderModelsFetch,
  ipcProviderModelsSuggestList,
  ipcProviderModelsSave,
  ipcProviderModelsDeleteSaved,
  ipcProviderModelsGetSaved,
  ipcProviderModelsEditSaved,
  ipcProviderModelsUpdateSettings,
  ipcProviderModelsResetContextWindow,
  ipcAgentRegistryList,
  ipcAgentRegistryGet,
  ipcAgentRegistryUpsert,
  ipcAgentRegistryDelete,
  ipcAgentRegistryCreateBlank,
  ipcAgentYamlExport,
  ipcAgentYamlImport,
  ipcRegexListGroups,
  ipcRegexCreateGroup,
  ipcRegexUpdateGroup,
  ipcRegexDeleteGroup,
  ipcRegexListRules,
  ipcRegexGetRule,
  ipcRegexCreateRule,
  ipcRegexUpdateRule,
  ipcRegexDeleteRule,
  ipcRegexListPicker,
  ipcRegexSetCurrent,
  ipcEventsGetConfig,
  ipcEventsSetConfig,
  ipcEventsClearConfig,
  ipcEventsExportYaml,
  ipcEventsImportYaml,
  ipcCompactionConditionsGet,
  ipcCompactionConditionsSet,
  ipcBackupExport,
  ipcBackupImport,
  ipcCloudSyncGetConfig,
  ipcCloudSyncSetConfig,
  ipcCloudSyncSetEnabled,
  ipcCloudSyncTestConnection,
  ipcCloudSyncGetLocalStatus,
  ipcCloudSyncPull,
  ipcCloudSyncPush,
  ipcShellMenuPopup,
  ipcShellSetTitleBarTheme,
  ipcAppOpenExternal,
  ipcAppGetInfo,
  ipcAppCheckForUpdates,
} = invokeClient;

export function onAgentStream(
  callback: (payload: AgentStreamEventPayload) => void,
): () => void {
  return bridge().on(
    IPC_CHANNELS.AGENT_STREAM,
    callback as (p: unknown) => void,
  );
}

/** 订阅 main 进程 agentActive refcount 变化。 */
export function onAgentActivity(
  callback: (payload: AgentActivityPayload) => void,
): () => void {
  return bridge().on(
    IPC_CHANNELS.AGENT_ACTIVITY,
    callback as (p: unknown) => void,
  );
}

/** 订阅 main 进程推送的工作区变更通知（VFS / 规则变更后 Explorer 刷新）。 */
export function onWorkspaceMutated(
  callback: (payload: WorkspaceMutatedPayload) => void,
): () => void {
  return bridge().on(
    IPC_CHANNELS.WORKSPACE_MUTATED,
    callback as (p: unknown) => void,
  );
}

/** 订阅规则差集 workplace 附件建议（Composer chips）。 */
export function onComposerAttachmentsSuggest(
  callback: (payload: ComposerAttachmentsSuggestPayload) => void,
): () => void {
  return bridge().on(
    IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST,
    callback as (p: unknown) => void,
  );
}

function vfsScope(
  workspaceScope: VfsScopeRequest['workspaceScope'],
  projectId?: string,
  sessionId?: string,
): VfsScopeRequest {
  return { workspaceScope, projectId, sessionId };
}

export { vfsScope };
