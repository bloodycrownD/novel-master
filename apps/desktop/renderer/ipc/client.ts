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
  type PromptChatTokenUpdatedPayload,
  type AgentUserMessageAppendedPayload,
  type VfsStartDragFailedPayload,
} from "@shared/ipc-types";
import { createInvokeClient } from "./invoke-registry";

export function getDesktopBridge() {
  if (window.novelMasterDesktop) return window.novelMasterDesktop;
  const inBrowser = typeof navigator !== "undefined" && !/Electron/i.test(navigator.userAgent);
  let reason = "novelMasterDesktop preload bridge is unavailable（preload 未加载，请重新 build 后启动 Electron）";
  if (inBrowser) reason = "novelMasterDesktop 仅在 Electron 中可用。请运行 npm run desktop:dev，不要直接在浏览器打开 localhost:5173。";
  throw new Error(reason);
}

const invokeClient = createInvokeClient((channel, arg) => getDesktopBridge().invoke(channel, arg));

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
  ipcSessionsListByProject,
  ipcSessionsCreate,
  ipcSessionsRename,
  ipcSessionsDelete,
  ipcSessionsGetComposerDraft,
  ipcSessionsSetComposerDraft,
  ipcSessionsProjectComposerStatus,
  ipcSessionsSetAgentBinding,
  ipcSessionsSetModelOverride,
  ipcAppUiGet,
  ipcAppUiSet,
  ipcWorkplaceBuildListRows,
  ipcWorkplaceSetDirRule,
  ipcWorkplaceSetFileRule,
  ipcWorkplaceGetDirRule,
  ipcVfsRead,
  ipcPhysicalList,
  ipcPhysicalRead,
  ipcVfsWrite,
  ipcVfsMkdir,
  ipcVfsDelete,
  ipcVfsRename,
  ipcVfsZipExport,
  ipcVfsZipImport,
  ipcVfsZipPick,
  ipcVfsZipImportBytes,
  ipcVfsCharacterCardImport,
  ipcVfsFilePick,
  ipcVfsFileExport,
  ipcVfsBatchIngestFromPaths,
  ipcVfsBatchExportStage,
  ipcVfsBatchClearStaging,
  ipcSessionsPullTemplate,
  ipcSessionsPushTemplate,
  ipcMessagesList,
  ipcMessagesAppend,
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
  ipcAgentRunIsActive,
  ipcAgentResolveCurrent,
  ipcAgentListPicker,
  ipcAgentSetCurrent,
  ipcModelListPicker,
  ipcModelSetCurrent,
  ipcPromptRealPreview,
  ipcPromptChatTokenLabel,
  ipcPromptAgentMeta,
  ipcCompactionManual,
  ipcUsageStatsQuery,
  ipcPreferencesGetLlmStream,
  ipcPreferencesSetLlmStream,
  ipcPreferencesGetSubagentStream,
  ipcPreferencesSetSubagentStream,
  ipcPreferencesGetThinkingContext,
  ipcPreferencesSetThinkingContext,
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
  ipcAgentRegistryUpdate,
  ipcAgentRegistryDelete,
  ipcAgentRegistryCreateBlank,
  ipcAgentYamlExport,
  ipcAgentYamlImport,

  ipcSmartSortRuleList,
  ipcSmartSortRuleCreate,
  ipcSmartSortRuleUpdate,
  ipcSmartSortRuleDelete,
  ipcSmartSortRuleDeleteBatch,
  ipcSmartSortRuleSetEnabled,
  ipcSmartSortRuleSetEnabledBatch,
  ipcSmartSortRuleMove,
  ipcSmartSortRuleReorder,
  ipcSmartSortRuleResetDefaults,
  ipcSmartSortRuleMatch,
  ipcSmartSortRuleYamlExport,
  ipcSmartSortRuleYamlImport,
  ipcSkillsList,
  ipcSkillsEffective,
  ipcSkillsRead,
  ipcSkillsWrite,
  ipcSkillsToggle,
  ipcSkillsDelete,
  ipcSkillsAssertCreateName,
  ipcSkillsUpdateInfo,
  ipcCompactionConditionsGet,
  ipcCompactionConditionsSet,
  ipcBackupExport,
  ipcBackupImport,
  ipcDbStats,
  ipcDbMaintenance,
  ipcCloudSyncGetConfig,
  ipcCloudSyncSetConfig,
  ipcCloudSyncSetEnabled,
  ipcCloudSyncTestConnection,
  ipcCloudSyncGetLocalStatus,
  ipcCloudSyncPull,
  ipcCloudSyncPush,
  ipcSearchGetConfig,
  ipcSearchSaveEngineKey,
  ipcSearchClearEngineKey,
  ipcSearchSetEngineOrder,
  ipcSearchSetEnabled,
  ipcSearchSetEngineBaseUrl,
  ipcSearchCreateCustomEngine,
  ipcSearchUpdateCustomEngine,
  ipcSearchDeleteCustomEngine,
  ipcSearchUpdatePresetOverride,
  ipcSearchResetPresetOverride,
  ipcSearchTestEngine,
  ipcShellMenuPopup,
  ipcShellSetTitleBarTheme,
  ipcAppOpenExternal,
  ipcAppGetInfo,
  ipcAppCheckForUpdates,
} = invokeClient;

export function onAgentStream(callback: (payload: AgentStreamEventPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.AGENT_STREAM, callback as (p: unknown) => void);
}

// nm-style: keep-public — IPC 通道 → 类型化订阅的绑定点；调用方不应知道 channel 常量
/** 订阅 main 进程 agentActive refcount 变化。 */
export function onAgentActivity(callback: (payload: AgentActivityPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.AGENT_ACTIVITY, callback as (p: unknown) => void);
}

// nm-style: keep-public — IPC 通道 → 类型化订阅的绑定点；调用方不应知道 channel 常量
/** 订阅 main 进程推送的工作区变更通知（VFS / 规则变更后 Explorer 刷新）。 */
export function onWorkspaceMutated(callback: (payload: WorkspaceMutatedPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.WORKSPACE_MUTATED, callback as (p: unknown) => void);
}

// nm-style: keep-public — IPC 通道 → 类型化订阅的绑定点；调用方不应知道 channel 常量
/** 订阅规则差集 workplace 附件建议（Composer chips）。 */
export function onComposerAttachmentsSuggest(callback: (payload: ComposerAttachmentsSuggestPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.COMPOSER_ATTACHMENTS_SUGGEST, callback as (p: unknown) => void);
}

/**
 * 订阅会话 prompt 占用读数的第二相推送（main 后台精确计数完成）。
 * 载荷恒为精确档；订阅方只在当前展示估算档时采纳（见 payload 类型注释）。
 */
export function onPromptChatTokenUpdated(callback: (payload: PromptChatTokenUpdatedPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.PROMPT_CHAT_TOKEN_UPDATED, callback as (p: unknown) => void);
}

// nm-style: keep-public — IPC 通道 → 类型化订阅的绑定点；调用方不应知道 channel 常量
/** 订阅用户消息 append 成功（清 annotate；勿与 started/RUN_* 混用）。 */
export function onUserMessageAppended(callback: (payload: AgentUserMessageAppendedPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.AGENT_USER_MESSAGE_APPENDED, callback as (p: unknown) => void);
}

// nm-style: keep-public — IPC 通道 → 类型化订阅的绑定点；调用方不应知道 channel 常量
/** 订阅 main startDrag 失败（拖出导出 toast）。 */
export function onVfsStartDragFailed(callback: (payload: VfsStartDragFailedPayload) => void): () => void {
  return getDesktopBridge().on(IPC_CHANNELS.VFS_START_DRAG_FAILED, callback as (p: unknown) => void);
}

export function vfsScope(workspaceScope: VfsScopeRequest["workspaceScope"], projectId?: string, sessionId?: string): VfsScopeRequest {
  return { workspaceScope, projectId, sessionId };
}
