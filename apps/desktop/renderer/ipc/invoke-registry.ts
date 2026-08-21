/**
 * IPC invoke 映射表（renderer 侧）：channel → 薄封装函数。
 */
import {
  IPC_CHANNELS,
  type AgentAbortRequest,
  type AgentListPickerResponse,
  type AgentRegistryGetResponse,
  type AgentResolveCurrentResponse,
  type AgentRunIsActiveRequest,
  type AgentRunRequest,
  type AgentSetCurrentRequest,
  type AgentActivityPayload,
  type AppCheckForUpdatesResponse,
  type AppGetInfoResponse,
  type AppOpenExternalRequest,
  type AppUiGetResponse,
  type BootstrapStatusResponse,
  type ChatMessageDto,
  type CompactionManualRequest,
  type IpcResult,
  type MessageAttachmentDto,
  type MessagesAppendRequest,
  type MessagesDeleteRequest,
  type MessagesEditRequest,
  type MessagesForkRequest,
  type MessagesHideRequest,
  type MessagesHideRangeRequest,
  type MessagesListRequest,
  type MessagesSearchRequest,
  type MessagesSetFloorPayload,
  type MessagesSetFloorResult,
  type MessagesShowRequest,
  type MessagesShowRangeRequest,
  type MessagesTruncateAfterRequest,
  type ModelListPickerResponse,
  type ModelSetCurrentRequest,
  type ProjectCreateRequest,
  type ProjectDeleteRequest,
  type ProjectAgentConfigDto,
  type ProjectDto,
  type ProjectGetAgentConfigRequest,
  type ProjectRenameRequest,
  type ProjectUpdateAgentConfigRequest,
  type PromptAgentMetaResponse,
  type PromptPreviewSegmentDto,
  type PromptChatTokenStatsResponse,
  type PromptScopeRequest,
  type ScopeSetProjectRequest,
  type ScopeSetSessionRequest,
  type ScopeSnapshotDto,
  type SessionCreateRequest,
  type SessionDeleteRequest,
  type SessionDto,
  type SessionFsRollbackRequest,
  type SessionGetComposerDraftRequest,
  type SessionGetAgentBindingRequest,
  type SessionListByProjectRequest,
  type SessionProjectComposerStatusRequest,
  type SessionPullTemplateRequest,
  type SessionRenameRequest,
  type SessionAgentConfigDto,
  type SessionSetAgentBindingRequest,
  type SessionSetComposerDraftRequest,
  type SessionSetModelOverrideRequest,

  type VfsBatchClearStagingRequest,
  type VfsBatchExportStageRequest,
  type VfsBatchExportStageResult,
  type VfsBatchIngestFromPathsRequest,
  type VfsBatchIngestFromPathsResult,
  type VfsDeleteRequest,
  type VfsMkdirRequest,
  type VfsReadRequest,
  type VfsReadResultDto,
  type VfsRenameRequest,
  type VfsWriteRequest,
  type VfsCharacterCardImportRequest,
  type VfsCharacterCardImportResult,
  type VfsZipExportResult,
  type VfsZipImportResult,
  type VfsZipPickResult,
  type VfsZipBytesImportRequest,
  type VfsZipRequest,
  type PhysicalListRequest,
  type PhysicalReadRequest,
  type WorkplaceBuildListRowsRequest,
  type WorkplaceGetDirRuleRequest,
  type WorkplaceCaptureSessionBlockRequest,
  type WorkplaceListRowDto,
  type WorkplaceSetDirRuleRequest,
  type WorkplaceSetFileRuleRequest,
  type EffectiveSkillDto,
  type SkillListItemDto,
  type SkillsDeleteRequest,
  type SkillsEditRequest,
  type SkillsEffectiveRequest,
  type SkillsListRequest,
  type SkillsReadRequest,
  type SkillsReadResponse,
  type SkillsToggleRequest,
  type SkillsWriteRequest,
} from '@shared/ipc-types';

export type InvokeFn = <T>(channel: string, arg?: unknown) => Promise<T>;

function noArg<T>(invoke: InvokeFn, channel: string): () => Promise<T> {
  return () => invoke<T>(channel);
}

function withReq<TReq, TRes>(
  invoke: InvokeFn,
  channel: string,
): (req: TReq) => Promise<TRes> {
  return req => invoke<TRes>(channel, req);
}

function withBool<TRes>(
  invoke: InvokeFn,
  channel: string,
): (enabled: boolean) => Promise<TRes> {
  return enabled => invoke<TRes>(channel, enabled);
}

/** 由 client.ts 注入 bridge().invoke，生成全部 ipc* 封装。 */
export function createInvokeClient(invoke: InvokeFn) {
  return {
    getBootstrapStatus: noArg<BootstrapStatusResponse>(
      invoke,
      IPC_CHANNELS.BOOTSTRAP_STATUS,
    ),
    rebootstrap: noArg<BootstrapStatusResponse>(
      invoke,
      IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP,
    ),
    ipcAgentActivityGet: noArg<AgentActivityPayload>(
      invoke,
      IPC_CHANNELS.AGENT_ACTIVITY_GET,
    ),
    ipcScopeGet: noArg<IpcResult<ScopeSnapshotDto>>(
      invoke,
      IPC_CHANNELS.SCOPE_GET,
    ),
    ipcScopeSetProject: withReq<
      ScopeSetProjectRequest,
      IpcResult<ScopeSnapshotDto>
    >(invoke, IPC_CHANNELS.SCOPE_SET_PROJECT),
    ipcScopeSetSession: withReq<
      ScopeSetSessionRequest,
      IpcResult<ScopeSnapshotDto>
    >(invoke, IPC_CHANNELS.SCOPE_SET_SESSION),
    ipcProjectsList: noArg<IpcResult<ProjectDto[]>>(
      invoke,
      IPC_CHANNELS.PROJECTS_LIST,
    ),
    ipcProjectsCreate: withReq<ProjectCreateRequest, IpcResult<ProjectDto>>(
      invoke,
      IPC_CHANNELS.PROJECTS_CREATE,
    ),
    ipcProjectsRename: withReq<ProjectRenameRequest, IpcResult<ProjectDto>>(
      invoke,
      IPC_CHANNELS.PROJECTS_RENAME,
    ),
    ipcProjectsDelete: withReq<ProjectDeleteRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.PROJECTS_DELETE,
    ),
    ipcProjectsGetAgentConfig: withReq<
      ProjectGetAgentConfigRequest,
      IpcResult<ProjectAgentConfigDto>
    >(invoke, IPC_CHANNELS.PROJECTS_GET_AGENT_CONFIG),
    ipcProjectsUpdateAgentConfig: withReq<
      ProjectUpdateAgentConfigRequest,
      IpcResult<ProjectAgentConfigDto>
    >(invoke, IPC_CHANNELS.PROJECTS_UPDATE_AGENT_CONFIG),
    ipcSessionsListByProject: withReq<
      SessionListByProjectRequest,
      IpcResult<SessionDto[]>
    >(invoke, IPC_CHANNELS.SESSIONS_LIST_BY_PROJECT),
    ipcSessionsCreate: withReq<SessionCreateRequest, IpcResult<SessionDto>>(
      invoke,
      IPC_CHANNELS.SESSIONS_CREATE,
    ),
    ipcSessionsRename: withReq<SessionRenameRequest, IpcResult<SessionDto>>(
      invoke,
      IPC_CHANNELS.SESSIONS_RENAME,
    ),
    ipcSessionsDelete: withReq<SessionDeleteRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.SESSIONS_DELETE,
    ),
    ipcSessionsGetComposerDraft: withReq<
      SessionGetComposerDraftRequest,
      IpcResult<string | null>
    >(invoke, IPC_CHANNELS.SESSIONS_GET_COMPOSER_DRAFT),
    ipcSessionsSetComposerDraft: withReq<
      SessionSetComposerDraftRequest,
      IpcResult<boolean>
    >(invoke, IPC_CHANNELS.SESSIONS_SET_COMPOSER_DRAFT),
    ipcSessionsProjectComposerStatus: withReq<
      SessionProjectComposerStatusRequest,
      IpcResult<MessageAttachmentDto[]>
    >(invoke, IPC_CHANNELS.SESSIONS_PROJECT_COMPOSER_STATUS),
    ipcSessionsGetAgentBinding: withReq<
      SessionGetAgentBindingRequest,
      IpcResult<SessionAgentConfigDto>
    >(invoke, IPC_CHANNELS.SESSIONS_GET_AGENT_BINDING),
    ipcSessionsSetAgentBinding: withReq<
      SessionSetAgentBindingRequest,
      IpcResult<SessionAgentConfigDto>
    >(invoke, IPC_CHANNELS.SESSIONS_SET_AGENT_BINDING),
    ipcSessionsSetModelOverride: withReq<
      SessionSetModelOverrideRequest,
      IpcResult<SessionAgentConfigDto>
    >(invoke, IPC_CHANNELS.SESSIONS_SET_MODEL_OVERRIDE),
    ipcAppUiGet: (key: string) =>
      invoke<AppUiGetResponse>(IPC_CHANNELS.APP_UI_GET, { key }),
    ipcAppUiSet: (key: string, value: string) =>
      invoke<IpcResult<void>>(IPC_CHANNELS.APP_UI_SET, { key, value }),
    ipcWorkplaceBuildListRows: withReq<
      WorkplaceBuildListRowsRequest,
      IpcResult<WorkplaceListRowDto[]>
    >(invoke, IPC_CHANNELS.WORKPLACE_BUILD_LIST_ROWS),
    ipcWorkplaceSetDirRule: withReq<WorkplaceSetDirRuleRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.WORKPLACE_SET_DIR_RULE,
    ),
    ipcWorkplaceSetFileRule: withReq<
      WorkplaceSetFileRuleRequest,
      IpcResult<void>
    >(invoke, IPC_CHANNELS.WORKPLACE_SET_FILE_RULE),
    ipcWorkplaceGetDirRule: withReq<
      WorkplaceGetDirRuleRequest,
      IpcResult<WorkplaceSetDirRuleRequest | null>
    >(invoke, IPC_CHANNELS.WORKPLACE_GET_DIR_RULE),
    ipcWorkplaceCaptureSessionBlock: withReq<
      WorkplaceCaptureSessionBlockRequest,
      IpcResult<void>
    >(invoke, IPC_CHANNELS.WORKPLACE_CAPTURE_SESSION_BLOCK),
    ipcVfsRead: withReq<VfsReadRequest, IpcResult<VfsReadResultDto>>(
      invoke,
      IPC_CHANNELS.VFS_READ,
    ),
    ipcPhysicalList: withReq<
      PhysicalListRequest,
      IpcResult<WorkplaceListRowDto[]>
    >(invoke, IPC_CHANNELS.PHYSICAL_LIST),
    ipcPhysicalRead: withReq<PhysicalReadRequest, IpcResult<VfsReadResultDto>>(
      invoke,
      IPC_CHANNELS.PHYSICAL_READ,
    ),
    ipcVfsWrite: withReq<VfsWriteRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.VFS_WRITE,
    ),
    ipcVfsMkdir: withReq<VfsMkdirRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.VFS_MKDIR,
    ),
    ipcVfsDelete: withReq<VfsDeleteRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.VFS_DELETE,
    ),
    ipcVfsRename: withReq<VfsRenameRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.VFS_RENAME,
    ),
    ipcVfsZipExport: withReq<VfsZipRequest, IpcResult<VfsZipExportResult>>(
      invoke,
      IPC_CHANNELS.VFS_ZIP_EXPORT,
    ),
    ipcVfsZipImport: withReq<VfsZipRequest, IpcResult<VfsZipImportResult>>(
      invoke,
      IPC_CHANNELS.VFS_ZIP_IMPORT,
    ),
    ipcVfsZipPick: noArg<IpcResult<VfsZipPickResult>>(
      invoke,
      IPC_CHANNELS.VFS_ZIP_PICK,
    ),
    ipcVfsZipImportBytes: withReq<
      VfsZipBytesImportRequest,
      IpcResult<void>
    >(invoke, IPC_CHANNELS.VFS_ZIP_IMPORT_BYTES),
    ipcVfsCharacterCardImport: withReq<
      VfsCharacterCardImportRequest,
      IpcResult<VfsCharacterCardImportResult>
    >(invoke, IPC_CHANNELS.VFS_CHARACTER_CARD_IMPORT),
    ipcVfsBatchIngestFromPaths: withReq<
      VfsBatchIngestFromPathsRequest,
      IpcResult<VfsBatchIngestFromPathsResult>
    >(invoke, IPC_CHANNELS.VFS_BATCH_INGEST_FROM_PATHS),
    ipcVfsBatchExportStage: withReq<
      VfsBatchExportStageRequest,
      IpcResult<VfsBatchExportStageResult>
    >(invoke, IPC_CHANNELS.VFS_BATCH_EXPORT_STAGE),
    ipcVfsBatchClearStaging: withReq<
      VfsBatchClearStagingRequest,
      IpcResult<void>
    >(invoke, IPC_CHANNELS.VFS_BATCH_CLEAR_STAGING),
    ipcSessionsPullTemplate: withReq<
      SessionPullTemplateRequest,
      IpcResult<void>
    >(invoke, IPC_CHANNELS.SESSIONS_PULL_TEMPLATE),
    ipcMessagesList: withReq<MessagesListRequest, IpcResult<ChatMessageDto[]>>(
      invoke,
      IPC_CHANNELS.MESSAGES_LIST,
    ),
    ipcMessagesSearch: withReq<
      MessagesSearchRequest,
      IpcResult<ChatMessageDto[]>
    >(invoke, IPC_CHANNELS.MESSAGES_SEARCH),
    ipcMessagesAppend: withReq<
      MessagesAppendRequest,
      IpcResult<ChatMessageDto>
    >(invoke, IPC_CHANNELS.MESSAGES_APPEND),
    ipcMessagesEdit: withReq<MessagesEditRequest, IpcResult<ChatMessageDto>>(
      invoke,
      IPC_CHANNELS.MESSAGES_EDIT,
    ),
    ipcMessagesHide: withReq<MessagesHideRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.MESSAGES_HIDE,
    ),
    ipcMessagesShow: withReq<MessagesShowRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.MESSAGES_SHOW,
    ),
    ipcMessagesHideRange: withReq<
      MessagesHideRangeRequest,
      IpcResult<{ count: number }>
    >(invoke, IPC_CHANNELS.MESSAGES_HIDE_RANGE),
    ipcMessagesShowRange: withReq<
      MessagesShowRangeRequest,
      IpcResult<{ count: number }>
    >(invoke, IPC_CHANNELS.MESSAGES_SHOW_RANGE),
    ipcMessagesTruncateAfter: withReq<
      MessagesTruncateAfterRequest,
      IpcResult<void>
    >(invoke, IPC_CHANNELS.MESSAGES_TRUNCATE_AFTER),
    ipcMessagesDelete: withReq<MessagesDeleteRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.MESSAGES_DELETE,
    ),
    ipcMessagesFork: withReq<MessagesForkRequest, IpcResult<SessionDto>>(
      invoke,
      IPC_CHANNELS.MESSAGES_FORK,
    ),
    ipcMessagesRollback: withReq<SessionFsRollbackRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.MESSAGES_ROLLBACK,
    ),
    ipcMessagesSetFloor: withReq<
      MessagesSetFloorPayload,
      IpcResult<MessagesSetFloorResult>
    >(invoke, IPC_CHANNELS.MESSAGES_SET_FLOOR),
    ipcAgentRun: withReq<AgentRunRequest, IpcResult<{ started: boolean }>>(
      invoke,
      IPC_CHANNELS.AGENT_RUN,
    ),
    ipcAgentAbort: withReq<AgentAbortRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.AGENT_ABORT,
    ),
    ipcAgentRunIsActive: withReq<AgentRunIsActiveRequest, IpcResult<boolean>>(
      invoke,
      IPC_CHANNELS.AGENT_RUN_IS_ACTIVE,
    ),
    ipcAgentResolveCurrent: noArg<IpcResult<AgentResolveCurrentResponse>>(
      invoke,
      IPC_CHANNELS.AGENT_RESOLVE_CURRENT,
    ),
    ipcAgentListPicker: noArg<IpcResult<AgentListPickerResponse>>(
      invoke,
      IPC_CHANNELS.AGENT_LIST_PICKER,
    ),
    ipcAgentSetCurrent: withReq<AgentSetCurrentRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.AGENT_SET_CURRENT,
    ),
    ipcModelListPicker: noArg<IpcResult<ModelListPickerResponse>>(
      invoke,
      IPC_CHANNELS.MODEL_LIST_PICKER,
    ),
    ipcModelSetCurrent: withReq<ModelSetCurrentRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.MODEL_SET_CURRENT,
    ),
    ipcPromptRealPreview: withReq<
      PromptScopeRequest,
      IpcResult<PromptPreviewSegmentDto[]>
    >(invoke, IPC_CHANNELS.PROMPT_REAL_PREVIEW),
    ipcPromptChatTokenLabel: withReq<
      PromptScopeRequest,
      IpcResult<PromptChatTokenStatsResponse>
    >(invoke, IPC_CHANNELS.PROMPT_CHAT_TOKEN_LABEL),
    ipcPromptAgentMeta: withReq<
      PromptScopeRequest,
      IpcResult<PromptAgentMetaResponse>
    >(invoke, IPC_CHANNELS.PROMPT_AGENT_META),
    ipcCompactionManual: withReq<
      CompactionManualRequest,
      IpcResult<{ ok: boolean }>
    >(invoke, IPC_CHANNELS.COMPACTION_MANUAL),
    ipcPreferencesGetSessionFsVersionCheck: noArg<IpcResult<boolean>>(
      invoke,
      IPC_CHANNELS.PREFERENCES_GET_SESSION_FS_VERSION_CHECK,
    ),
    ipcPreferencesSetSessionFsVersionCheck: withBool<IpcResult<void>>(
      invoke,
      IPC_CHANNELS.PREFERENCES_SET_SESSION_FS_VERSION_CHECK,
    ),
    ipcPreferencesGetLlmStream: noArg<IpcResult<boolean>>(
      invoke,
      IPC_CHANNELS.PREFERENCES_GET_LLM_STREAM,
    ),
    ipcPreferencesSetLlmStream: withBool<IpcResult<void>>(
      invoke,
      IPC_CHANNELS.PREFERENCES_SET_LLM_STREAM,
    ),
    ipcProvidersList: noArg(invoke, IPC_CHANNELS.PROVIDERS_LIST),
    ipcProvidersGet: withReq<{ providerId: string }, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDERS_GET,
    ),
    ipcProvidersCreate: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDERS_CREATE,
    ),
    ipcProvidersEdit: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDERS_EDIT,
    ),
    ipcProvidersDelete: withReq<{ providerId: string }, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDERS_DELETE,
    ),
    ipcProviderModelsSavedList: withReq<{ providerId: string }, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_SAVED_LIST,
    ),
    ipcProviderModelsFetch: withReq<{ providerId: string }, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_FETCH,
    ),
    ipcProviderModelsSuggestList: withReq<{ providerId: string }, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_SUGGEST_LIST,
    ),
    ipcProviderModelsSave: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_SAVE,
    ),
    ipcProviderModelsDeleteSaved: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_DELETE_SAVED,
    ),
    ipcProviderModelsGetSaved: withReq<{ savedModelId: string }, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_GET_SAVED,
    ),
    ipcProviderModelsEditSaved: withReq<
      { savedModelId: string; modelName?: string },
      unknown
    >(invoke, IPC_CHANNELS.PROVIDER_MODELS_EDIT_SAVED),
    ipcProviderModelsUpdateSettings: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_UPDATE_SETTINGS,
    ),
    ipcProviderModelsResetContextWindow: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.PROVIDER_MODELS_RESET_CONTEXT_WINDOW,
    ),
    ipcAgentRegistryList: noArg(invoke, IPC_CHANNELS.AGENT_REGISTRY_LIST),
    ipcAgentRegistryGet: withReq<
      { agentId: string },
      IpcResult<AgentRegistryGetResponse>
    >(invoke, IPC_CHANNELS.AGENT_REGISTRY_GET),
    ipcAgentRegistryUpsert: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.AGENT_REGISTRY_UPSERT,
    ),
    ipcAgentRegistryDelete: withReq<{ agentId: string }, unknown>(
      invoke,
      IPC_CHANNELS.AGENT_REGISTRY_DELETE,
    ),
    ipcAgentRegistryCreateBlank: noArg(
      invoke,
      IPC_CHANNELS.AGENT_REGISTRY_CREATE_BLANK,
    ),
    ipcAgentYamlExport: withReq<{ agentId: string }, unknown>(
      invoke,
      IPC_CHANNELS.AGENT_YAML_EXPORT,
    ),
    ipcAgentYamlImport: withReq<{ agentId: string }, unknown>(
      invoke,
      IPC_CHANNELS.AGENT_YAML_IMPORT,
    ),

    ipcRegexListGroups: noArg(invoke, IPC_CHANNELS.REGEX_LIST_GROUPS),
    ipcRegexCreateGroup: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_CREATE_GROUP,
    ),
    ipcRegexUpdateGroup: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_UPDATE_GROUP,
    ),
    ipcRegexDeleteGroup: withReq<{ groupId: string }, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_DELETE_GROUP,
    ),
    ipcRegexListRules: withReq<{ groupId: string }, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_LIST_RULES,
    ),
    ipcRegexGetRule: withReq<{ groupId: string; ruleId: string }, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_GET_RULE,
    ),
    ipcRegexCreateRule: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_CREATE_RULE,
    ),
    ipcRegexUpdateRule: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_UPDATE_RULE,
    ),
    ipcRegexDeleteRule: withReq<{ groupId: string; ruleId: string }, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_DELETE_RULE,
    ),
    ipcRegexListPicker: noArg(invoke, IPC_CHANNELS.REGEX_LIST_PICKER),
    ipcRegexSetCurrent: withReq<{ groupId: string | null }, unknown>(
      invoke,
      IPC_CHANNELS.REGEX_SET_CURRENT,
    ),
    ipcSkillsList: withReq<
      SkillsListRequest,
      IpcResult<SkillListItemDto[]>
    >(invoke, IPC_CHANNELS.SKILLS_LIST),
    ipcSkillsEffective: withReq<
      SkillsEffectiveRequest,
      IpcResult<EffectiveSkillDto[]>
    >(invoke, IPC_CHANNELS.SKILLS_EFFECTIVE),
    ipcSkillsRead: withReq<
      SkillsReadRequest,
      IpcResult<SkillsReadResponse>
    >(invoke, IPC_CHANNELS.SKILLS_READ),
    ipcSkillsWrite: withReq<
      SkillsWriteRequest,
      IpcResult<{ version: number }>
    >(invoke, IPC_CHANNELS.SKILLS_WRITE),
    ipcSkillsEdit: withReq<
      SkillsEditRequest,
      IpcResult<{ version: number; replacements: number }>
    >(invoke, IPC_CHANNELS.SKILLS_EDIT),
    ipcSkillsToggle: withReq<SkillsToggleRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.SKILLS_TOGGLE,
    ),
    ipcSkillsDelete: withReq<SkillsDeleteRequest, IpcResult<void>>(
      invoke,
      IPC_CHANNELS.SKILLS_DELETE,
    ),
    ipcCompactionConditionsGet: noArg(
      invoke,
      IPC_CHANNELS.COMPACTION_CONDITIONS_GET,
    ),
    ipcCompactionConditionsSet: withReq<unknown, unknown>(
      invoke,
      IPC_CHANNELS.COMPACTION_CONDITIONS_SET,
    ),
    ipcBackupExport: noArg(invoke, IPC_CHANNELS.BACKUP_EXPORT),
    ipcBackupImport: noArg(invoke, IPC_CHANNELS.BACKUP_IMPORT),
    ipcCloudSyncGetConfig: noArg(invoke, IPC_CHANNELS.CLOUD_SYNC_GET_CONFIG),
    ipcCloudSyncSetConfig: withReq<
      {
        endpoint: string;
        bucket: string;
        region: string;
        pathPrefix: string;
        accessKeyId: string;
        secretAccessKey?: string;
        forcePathStyle: boolean;
        deviceLabel?: string;
      },
      unknown
    >(invoke, IPC_CHANNELS.CLOUD_SYNC_SET_CONFIG),
    ipcCloudSyncSetEnabled: withBool<unknown>(
      invoke,
      IPC_CHANNELS.CLOUD_SYNC_SET_ENABLED,
    ),
    ipcCloudSyncTestConnection: noArg(
      invoke,
      IPC_CHANNELS.CLOUD_SYNC_TEST_CONNECTION,
    ),
    ipcCloudSyncGetLocalStatus: noArg(
      invoke,
      IPC_CHANNELS.CLOUD_SYNC_GET_LOCAL_STATUS,
    ),
    ipcCloudSyncPull: noArg(invoke, IPC_CHANNELS.CLOUD_SYNC_PULL),
    ipcCloudSyncPush: (req?: { forceOverwriteRemote?: boolean }) =>
      invoke(IPC_CHANNELS.CLOUD_SYNC_PUSH, req),
    ipcShellMenuPopup: withReq<
      {
        menuId: 'file' | 'edit' | 'view' | 'window' | 'help';
        x: number;
        y: number;
      },
      IpcResult<null>
    >(invoke, IPC_CHANNELS.SHELL_MENU_POPUP),
    ipcShellSetTitleBarTheme: (theme: 'light' | 'dark') =>
      invoke(IPC_CHANNELS.SHELL_SET_TITLEBAR_THEME, theme),
    ipcAppOpenExternal: (url: string) => {
      const req: AppOpenExternalRequest = { url };
      return invoke<IpcResult<void>>(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, req);
    },
    ipcAppGetInfo: noArg<AppGetInfoResponse>(invoke, IPC_CHANNELS.APP_GET_INFO),
    ipcAppCheckForUpdates: noArg<AppCheckForUpdatesResponse>(
      invoke,
      IPC_CHANNELS.APP_CHECK_FOR_UPDATES,
    ),
  } as const;
}
