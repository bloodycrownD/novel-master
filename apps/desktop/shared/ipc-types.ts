/**
 * IPC channel names and serializable DTOs shared by main, preload, and renderer.
 * Single source of truth — handlers must not invent ad-hoc channel strings.
 */

export const IPC_CHANNELS = {
  BOOTSTRAP_STATUS: "nm:bootstrap/status",
  BOOTSTRAP_REBOOTSTRAP: "nm:bootstrap/rebootstrap",
  AGENT_STREAM: "nm:agent-stream",
  /** Main → renderer：agentActive refcount 变化（工具卡「执行中」等） */
  AGENT_ACTIVITY: "nm:agent/activity",
  AGENT_ACTIVITY_GET: "nm:agent/activity/get",
  /** Main → renderer：VFS / worktree 可视变更通知（消费方 ① 刷新 Explorer） */
  WORKSPACE_MUTATED: "nm:workspace/mutated",

  SCOPE_GET: "nm:scope/get",
  SCOPE_SET_PROJECT: "nm:scope/setProject",
  SCOPE_SET_SESSION: "nm:scope/setSession",

  PROJECTS_LIST: "nm:projects/list",
  PROJECTS_CREATE: "nm:projects/create",
  PROJECTS_RENAME: "nm:projects/rename",
  PROJECTS_DELETE: "nm:projects/delete",
  PROJECTS_GET_AGENT_CONFIG: "nm:projects/getAgentConfig",
  PROJECTS_UPDATE_AGENT_CONFIG: "nm:projects/updateAgentConfig",

  SESSIONS_LIST_BY_PROJECT: "nm:sessions/listByProject",
  SESSIONS_CREATE: "nm:sessions/create",
  SESSIONS_RENAME: "nm:sessions/rename",
  SESSIONS_DELETE: "nm:sessions/delete",

  APP_UI_GET: "nm:app-ui/get",
  APP_UI_SET: "nm:app-ui/set",

  VFS_LIST: "nm:vfs/list",
  VFS_READ: "nm:vfs/read",
  VFS_WRITE: "nm:vfs/write",
  VFS_MKDIR: "nm:vfs/mkdir",
  VFS_DELETE: "nm:vfs/delete",
  VFS_RENAME: "nm:vfs/rename",
  VFS_ZIP_EXPORT: "nm:vfs/zipExport",
  VFS_ZIP_IMPORT: "nm:vfs/zipImport",

  WORKTREE_BUILD_LIST_ROWS: "nm:worktree/buildListRows",
  WORKTREE_SET_DIR_RULE: "nm:worktree/setDirRule",
  WORKTREE_SET_FILE_RULE: "nm:worktree/setFileRule",
  WORKTREE_GET_DIR_RULE: "nm:worktree/getDirRule",
  WORKTREE_INVALIDATE_SESSION_SNAPSHOT:
    "nm:worktree/invalidateSessionSnapshot",

  PROJECTS_PULL_TEMPLATE: "nm:projects/pullTemplate",
  SESSIONS_PULL_TEMPLATE: "nm:sessions/pullTemplate",

  MESSAGES_LIST: "nm:messages/list",
  MESSAGES_APPEND: "nm:messages/append",
  MESSAGES_EDIT: "nm:messages/edit",
  MESSAGES_HIDE: "nm:messages/hide",
  MESSAGES_SHOW: "nm:messages/show",
  MESSAGES_HIDE_RANGE: "nm:messages/hideRange",
  MESSAGES_SHOW_RANGE: "nm:messages/showRange",
  MESSAGES_TRUNCATE_AFTER: "nm:messages/truncateAfter",
  MESSAGES_DELETE: "nm:messages/delete",
  MESSAGES_FORK: "nm:messages/fork",
  MESSAGES_ROLLBACK: "nm:messages/rollback",
  MESSAGES_APPEND_TOOL_TURN_BRIDGE: "nm:messages/appendToolTurnBridge",

  AGENT_RUN: "nm:agent/run",
  AGENT_ABORT: "nm:agent/abort",
  AGENT_RESOLVE_CURRENT: "nm:agent/resolveCurrent",
  AGENT_LIST_PICKER: "nm:agent/listPicker",
  AGENT_SET_CURRENT: "nm:agent/setCurrent",

  MODEL_LIST_PICKER: "nm:model/listPicker",
  MODEL_SET_CURRENT: "nm:model/setCurrent",

  PROMPT_REAL_PREVIEW: "nm:prompt/realPreview",
  PROMPT_CHAT_TOKEN_LABEL: "nm:prompt/chatTokenLabel",
  PROMPT_AGENT_META: "nm:prompt/agentMeta",

  COMPACTION_MANUAL: "nm:compaction/manual",

  PREFERENCES_GET_SESSION_FS_VERSION_CHECK:
    "nm:preferences/getSessionFsVersionCheck",
  PREFERENCES_SET_SESSION_FS_VERSION_CHECK:
    "nm:preferences/setSessionFsVersionCheck",
  PREFERENCES_GET_LLM_STREAM: "nm:preferences/getLlmStream",
  PREFERENCES_SET_LLM_STREAM: "nm:preferences/setLlmStream",

  PROVIDERS_LIST: "nm:providers/list",
  PROVIDERS_GET: "nm:providers/get",
  PROVIDERS_CREATE: "nm:providers/create",
  PROVIDERS_EDIT: "nm:providers/edit",
  PROVIDERS_DELETE: "nm:providers/delete",

  PROVIDER_MODELS_SAVED_LIST: "nm:providerModels/savedList",
  PROVIDER_MODELS_FETCH: "nm:providerModels/fetch",
  PROVIDER_MODELS_SUGGEST_LIST: "nm:providerModels/suggestList",
  PROVIDER_MODELS_SAVE: "nm:providerModels/save",
  PROVIDER_MODELS_DELETE_SAVED: "nm:providerModels/deleteSaved",
  PROVIDER_MODELS_GET_SAVED: "nm:providerModels/getSaved",
  PROVIDER_MODELS_UPDATE_SETTINGS: "nm:providerModels/updateSettings",
  PROVIDER_MODELS_RESET_CONTEXT_WINDOW:
    "nm:providerModels/resetContextWindow",
  PROVIDER_MODELS_EDIT_SAVED: "nm:providerModels/editSaved",

  AGENT_REGISTRY_LIST: "nm:agentRegistry/list",
  AGENT_REGISTRY_GET: "nm:agentRegistry/get",
  AGENT_REGISTRY_UPSERT: "nm:agentRegistry/upsert",
  AGENT_REGISTRY_DELETE: "nm:agentRegistry/delete",
  AGENT_REGISTRY_CREATE_BLANK: "nm:agentRegistry/createBlank",

  AGENT_YAML_EXPORT: "nm:agentYaml/export",
  AGENT_YAML_IMPORT: "nm:agentYaml/import",

  REGEX_LIST_GROUPS: "nm:regex/listGroups",
  REGEX_GET_GROUP: "nm:regex/getGroup",
  REGEX_CREATE_GROUP: "nm:regex/createGroup",
  REGEX_UPDATE_GROUP: "nm:regex/updateGroup",
  REGEX_DELETE_GROUP: "nm:regex/deleteGroup",
  REGEX_LIST_RULES: "nm:regex/listRules",
  REGEX_GET_RULE: "nm:regex/getRule",
  REGEX_CREATE_RULE: "nm:regex/createRule",
  REGEX_UPDATE_RULE: "nm:regex/updateRule",
  REGEX_DELETE_RULE: "nm:regex/deleteRule",
  REGEX_LIST_PICKER: "nm:regex/listPicker",
  REGEX_SET_CURRENT: "nm:regex/setCurrent",

  EVENTS_GET_CONFIG: "nm:events/getConfig",
  EVENTS_SET_CONFIG: "nm:events/setConfig",
  EVENTS_CLEAR_CONFIG: "nm:events/clearConfig",
  EVENTS_EXPORT_YAML: "nm:events/exportYaml",
  EVENTS_IMPORT_YAML: "nm:events/importYaml",

  COMPACTION_CONDITIONS_GET: "nm:compactionConditions/get",
  COMPACTION_CONDITIONS_SET: "nm:compactionConditions/set",

  BACKUP_EXPORT: "nm:backup/export",
  BACKUP_IMPORT: "nm:backup/import",

  CLOUD_SYNC_GET_CONFIG: "nm:cloud-sync/getConfig",
  CLOUD_SYNC_SET_CONFIG: "nm:cloud-sync/setConfig",
  CLOUD_SYNC_SET_ENABLED: "nm:cloud-sync/setEnabled",
  CLOUD_SYNC_TEST_CONNECTION: "nm:cloud-sync/testConnection",
  CLOUD_SYNC_GET_LOCAL_STATUS: "nm:cloud-sync/getLocalStatus",
  CLOUD_SYNC_PULL: "nm:cloud-sync/pull",
  CLOUD_SYNC_PUSH: "nm:cloud-sync/push",

  SHELL_MENU_POPUP: "nm:shell/menuPopup",
  SHELL_SET_TITLEBAR_THEME: "nm:shell/setTitleBarTheme",
  SHELL_OPEN_EXTERNAL: "nm:shell/openExternal",

  APP_GET_INFO: "nm:app/getInfo",
  APP_CHECK_FOR_UPDATES: "nm:app/checkForUpdates",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type IpcErrorPayload = {
  readonly code: string;
  readonly message: string;
  /** revision 缺失需回补时，丢失快照的逻辑路径列表。 */
  readonly missingLogicalPaths?: readonly string[];
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

/** 项目智能体策略模式。 */
export type ProjectAgentModeDto = "follow" | "custom";

/** 项目智能体配置（IPC 传输）。 */
export type ProjectAgentConfigDto = {
  readonly mode: ProjectAgentModeDto;
  readonly definition?: unknown;
};

export type ProjectGetAgentConfigRequest = {
  readonly projectId: string;
};

export type ProjectUpdateAgentConfigRequest = {
  readonly projectId: string;
  readonly patch: {
    readonly mode?: ProjectAgentModeDto;
    readonly definition?: unknown;
  };
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

export type AppGetInfoData = {
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly name: string;
};

export type AppGetInfoResponse = IpcResult<AppGetInfoData>;

export type UpdateCheckStatus = "up-to-date" | "update-available";

export type UpdateCheckData = {
  readonly localVersion: string;
  readonly remoteVersion: string;
  readonly tagName: string;
  readonly releaseUrl: string;
  readonly releaseNotesExcerpt: string;
  readonly status: UpdateCheckStatus;
};

export type AppCheckForUpdatesResponse = IpcResult<UpdateCheckData>;

export type AppOpenExternalRequest = {
  readonly url: string;
};

/** Workspace panel scope for VFS IPC (maps chat nav → VFS domain). */
export type WorkspacePanelScope = "global" | "session" | "chat";

export type VfsScopeRequest = {
  readonly workspaceScope: WorkspacePanelScope;
  readonly projectId?: string;
  readonly sessionId?: string;
};

export type VfsListRequest = VfsScopeRequest & {
  readonly path: string;
  readonly recursive?: boolean;
};

export type VfsReadRequest = VfsScopeRequest & {
  readonly path: string;
};

export type VfsWriteRequest = VfsScopeRequest & {
  readonly path: string;
  readonly content: string;
  readonly expectedVersion?: number;
  readonly versionCheck?: boolean;
  /** 编辑器上次读盘快照，仅用于漂移诊断日志，不作 baseline。 */
  readonly lastKnownContent?: string | null;
};

export type VfsMkdirRequest = VfsScopeRequest & {
  readonly path: string;
};

export type VfsDeleteRequest = VfsScopeRequest & {
  readonly path: string;
  readonly recursive?: boolean;
};

export type VfsRenameRequest = VfsScopeRequest & {
  readonly oldPath: string;
  readonly newPath: string;
};

export type VfsZipRequest = VfsScopeRequest & {
  readonly confirmed?: boolean;
};

export type VfsZipExportResult = "saved" | "cancelled";
export type VfsZipImportResult = "imported" | "cancelled";

export type VfsListEntryDto = {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly version?: number;
  readonly mtimeMs?: number;
};

export type VfsReadResultDto = {
  readonly content: string;
  readonly version: number;
  readonly mtimeMs: number;
};

export type WorktreeListRowDto = {
  readonly kind: "dir" | "file";
  readonly path: string;
  readonly ruleState: string;
  readonly inclusionMode: string;
  readonly displayState: string;
};

export type WorktreeBuildListRowsRequest = VfsScopeRequest;

export type WorktreeSetDirRuleRequest = VfsScopeRequest & {
  readonly logicalPath: string;
  readonly ruleEnabled?: boolean;
  readonly sortField?: "name" | "created" | "updated";
  readonly sortOrder?: "asc" | "desc";
  readonly headCount?: number;
  readonly tailCount?: number;
  readonly fillPolicy?: "hidden" | "filename" | "header";
};

export type WorktreeSetFileRuleRequest = VfsScopeRequest & {
  readonly logicalPath: string;
  readonly inclusionMode: "auto" | "show" | "hide";
};

export type WorktreeGetDirRuleRequest = VfsScopeRequest & {
  readonly logicalPath: string;
};

/** 手动刷新工作树：仅标记会话 worktree 快照 dirty（消费方 ②）。 */
export type WorktreeInvalidateSessionSnapshotRequest = {
  readonly projectId: string;
  readonly sessionId: string;
};

export type SessionFsRollbackRequest = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messageId: string;
  /** 为 true 时仅截断消息，不恢复工作区文件。 */
  readonly skipVfsReconcile?: boolean;
  /** 为 true 时 revision 缺失 path 使用 head 回补，其余 path 正常回滚。 */
  readonly revisionHeadBackfill?: boolean;
};

export type ProjectPullTemplateRequest = {
  readonly projectId: string;
};

export type SessionPullTemplateRequest = {
  readonly sessionId: string;
};

export type MessagesListRequest = {
  readonly sessionId: string;
};

export type ContentBlockDto =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string;
      readonly ok?: boolean;
      readonly summary?: string;
    };

/** 会话消息 synthetic 元数据（对应 core `MessageMetadata`）。 */
export type MessageMetadataDto = {
  readonly source?: "user";
  readonly actor?: "user";
  readonly synthetic?: boolean;
  readonly kind?: string;
  readonly toolInputCompressed?: boolean;
};

export type ChatMessageDto = {
  readonly id: string;
  readonly sessionId: string;
  readonly role: string;
  readonly hidden: boolean;
  readonly seq: number;
  readonly createdAtMs: number;
  readonly bodyText: string;
  readonly contentBlocks: readonly ContentBlockDto[];
  /** synthetic 识别（VFS UA 折叠等）；无则 undefined。 */
  readonly metadata?: MessageMetadataDto;
};

export type MessagesAppendRequest = {
  readonly sessionId: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
};

export type MessagesEditRequest = {
  readonly messageId: string;
  readonly text: string;
};

export type MessagesHideRequest = {
  readonly messageId: string;
};

export type MessagesShowRequest = {
  readonly messageId: string;
};

export type MessagesHideRangeRequest = {
  readonly sessionId: string;
  readonly fromSeq: number;
  readonly toSeq: number;
};

export type MessagesShowRangeRequest = {
  readonly sessionId: string;
  readonly fromSeq: number;
  readonly toSeq: number;
};

/** 批量删 / tail 截断：保留 seq ≤ afterSeq 的消息。 */
export type MessagesTruncateAfterRequest = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly afterSeq: number;
};

export type MessagesDeleteRequest = {
  readonly messageId: string;
};

export type MessagesForkRequest = {
  readonly sessionId: string;
  readonly messageId: string;
};

export type MessagesAppendToolTurnBridgeRequest = {
  readonly sessionId: string;
};

export type AgentRunRequest = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly userContent: string;
  readonly stream?: boolean;
  readonly allowResumeWithoutInput?: boolean;
};

export type AgentAbortRequest = {
  readonly sessionId: string;
};

export type AgentResolveCurrentResponse = {
  readonly agentId: string | undefined;
  readonly agentName: string;
  readonly modelLabel: string;
  readonly hasDedicatedModel: boolean;
};

export type AgentPickerRowDto = {
  readonly agentId: string;
  readonly label: string;
};

export type AgentListPickerResponse = {
  readonly rows: readonly AgentPickerRowDto[];
  readonly currentId: string | undefined;
};

export type AgentSetCurrentRequest = {
  readonly agentId: string;
};

export type ModelPickerRowDto = {
  readonly savedModelId: string;
  readonly label: string;
};

export type ModelListPickerResponse = {
  readonly rows: readonly ModelPickerRowDto[];
  readonly currentId: string | undefined;
};

export type ModelSetCurrentRequest = {
  readonly savedModelId: string;
};

export type PromptScopeRequest = {
  readonly projectId: string;
  readonly sessionId: string;
};

export type PromptPreviewSegmentDto = {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
};

export type PromptAgentMetaResponse = {
  readonly source: "global" | "project-custom" | "none";
  readonly agentId?: string;
  readonly agentName: string;
  readonly modelLabel: string;
  readonly hasDedicatedModel: boolean;
};

/** Structured chat context usage for workspace footer (prototype token bar). */
export type PromptChatTokenStatsResponse = {
  readonly tokenCount: number;
  readonly contextWindow?: number;
  readonly pct?: number;
  readonly estimated: boolean;
  readonly counterKind: string;
};

export type CompactionManualRequest = PromptScopeRequest;

export type AgentStreamEventPayload = {
  readonly type: string;
  readonly payload: unknown;
};

/** Main 进程 agentActive refcount 推送给 renderer 的载荷。 */
export type AgentActivityPayload = {
  readonly active: boolean;
};

/** Main 进程在 VFS / worktree 规则变更成功后推送给 renderer 的载荷。 */
export type WorkspaceMutatedPayload = {
  readonly workspaceScope: WorkspacePanelScope;
  readonly projectId?: string;
  readonly sessionId?: string;
};

export type PreviewFileSelection = {
  readonly workspaceScope: WorkspacePanelScope;
  readonly path: string;
  readonly name: string;
  /** 文件在工作区已不存在时为 true（VS Code 式删除态 tab） */
  readonly isDeleted?: boolean;
};

export type ProviderListItemDto = {
  readonly id: string;
  readonly displayName: string | null;
  readonly protocol: string;
  readonly baseUrl: string;
  readonly isBuiltin: boolean;
  readonly apiKeyStatus: "set" | "not set";
  readonly savedCount: number;
};

export type ProviderDetailDto = {
  readonly id: string;
  readonly displayName: string | null;
  readonly protocol: string;
  readonly baseUrl: string;
  readonly isBuiltin: boolean;
  readonly headers: Record<string, string>;
  readonly apiKeyStatus: "set" | "not set";
};

export type ProviderCreateRequest = {
  readonly id: string;
  readonly protocol: "openai" | "anthropic" | "gemini";
  readonly baseUrl: string;
  readonly displayName?: string;
  readonly apiKey: string;
  readonly headers?: Record<string, string>;
};

export type ProviderEditRequest = {
  readonly providerId: string;
  readonly protocol?: "openai" | "anthropic" | "gemini";
  readonly baseUrl?: string;
  readonly displayName?: string | null;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
};

export type ProviderIdRequest = {
  readonly providerId: string;
};

export type ProviderModelSavedDto = {
  readonly id: string;
  readonly vendorModelId: string;
  readonly modelName: string;
  /** handler 派生：provider/modelName */
  readonly displayName: string;
};

export type ProviderModelSuggestionDto = {
  readonly vendorModelId: string;
  readonly displayName: string;
  readonly stale: boolean;
};

export type ProviderModelSavedDetailDto = {
  readonly id: string;
  readonly providerId: string;
  readonly vendorModelId: string;
  readonly modelName: string;
  readonly displayName: string;
  readonly settings: unknown;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type ProviderModelsSavedListRequest = ProviderIdRequest;

export type ProviderModelsFetchRequest = ProviderIdRequest;

export type ProviderModelsSaveRequest = ProviderIdRequest & {
  readonly vendorModelId: string;
  readonly modelName?: string;
};

export type ProviderModelsDeleteSavedRequest = {
  readonly savedModelId: string;
  readonly providerId?: string;
};

export type ProviderModelsGetSavedRequest = {
  readonly savedModelId: string;
};

export type ProviderModelsEditSavedRequest = {
  readonly savedModelId: string;
  readonly modelName?: string;
};

export type ProviderModelsUpdateSettingsRequest = {
  readonly savedModelId: string;
  readonly contextWindowTokens?: number;
  readonly tokenCounterMode?: string;
  readonly sampling?: unknown;
  readonly thinkingLevel?: "off" | "low" | "medium" | "high";
};

export type ProviderModelsResetContextWindowRequest = {
  readonly savedModelId: string;
};

/** 存储配置失效摘要（列表/编辑 assess 结果）。 */
export type StoredConfigInvalidDto = {
  readonly code: "outdated_version" | "broken_wire" | "removed_feature";
  readonly message: string;
  readonly storedSchemaVersion?: number;
};

export type AgentRegistryListItemDto = {
  readonly agentId: string;
  readonly name: string;
  /**
   * 配置失效详情；有值表示该 Agent 须修复或删除。
   * @deprecated 兼容旧 UI，请改用 `invalid`
   */
  readonly decodeError?: string;
  readonly invalid?: StoredConfigInvalidDto;
};

export type AgentRegistryGetRequest = {
  readonly agentId: string;
};

/** Agent 原始 wire（供 renderer assess，不做 strict decode）。 */
export type AgentRegistryGetResponse = {
  readonly wire: unknown;
};

export type AgentRegistryUpsertRequest = {
  readonly agentId: string;
  readonly definition: unknown;
};

export type AgentRegistryDeleteRequest = {
  readonly agentId: string;
};

export type AgentYamlExportRequest = {
  readonly agentId: string;
};

export type AgentYamlImportRequest = {
  readonly agentId: string;
};

export type RegexGroupDto = {
  readonly groupId: string;
  readonly displayName: string | null;
  readonly ruleCount: number;
};

export type RegexGroupIdRequest = {
  readonly groupId: string;
};

export type RegexCreateGroupRequest = {
  readonly groupId: string;
  readonly displayName?: string;
};

export type RegexUpdateGroupRequest = {
  readonly groupId: string;
  readonly displayName?: string | null;
};

export type RegexRuleDto = {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly startDepth: number | null;
  readonly endDepth: number | null;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
};

export type RegexRuleIdRequest = RegexGroupIdRequest & {
  readonly ruleId: string;
};

export type RegexCreateRuleRequest = RegexGroupIdRequest & {
  readonly rule: Omit<RegexRuleDto, "ruleId"> & { readonly ruleId?: string };
};

export type RegexUpdateRuleRequest = RegexRuleIdRequest & {
  readonly patch: Partial<Omit<RegexRuleDto, "ruleId">>;
};

export type RegexPickerRowDto = {
  readonly groupId: string;
  readonly label: string;
};

export type RegexListPickerResponse = {
  readonly rows: readonly RegexPickerRowDto[];
  readonly currentId: string | undefined;
};

export type RegexSetCurrentRequest = {
  readonly groupId: string | null;
};

export type EventsGetConfigResponse = {
  /** strict decode 结果；含未知 action 等无法解析时为 null。 */
  readonly config: unknown | null;
  /** KKV 原始 wire，供编辑器宽松加载。 */
  readonly wire: unknown;
};

export type EventsSetConfigRequest = {
  readonly config: unknown;
};

export type CompactionConditionsDto = {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
};

export type CompactionConditionsSetRequest = {
  readonly conditions: CompactionConditionsDto;
};

export type BackupExportResult = "saved" | "cancelled";
export type BackupImportResult = "imported" | "cancelled";

export type CloudSyncConfigDto = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly pathPrefix: string;
  readonly accessKeyId: string;
  readonly forcePathStyle: boolean;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly hasSecretKey: boolean;
  readonly enabled: boolean;
};

export type CloudSyncSetEnabledRequest = {
  readonly enabled: boolean;
};

export type CloudSyncSetConfigRequest = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly pathPrefix: string;
  readonly accessKeyId: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle: boolean;
  readonly deviceLabel?: string;
};

export type CloudSyncLocalStatusDto = {
  readonly configured: boolean;
  readonly deviceId?: string;
  readonly deviceLabel?: string;
  readonly lastSyncedRev: number;
  readonly remoteRev?: number;
  readonly lastPullAt?: string;
  readonly lastPushAt?: string;
  readonly lastPullResult?: string;
  readonly lastPushResult?: string;
  readonly suggestsPull: boolean;
  readonly syncBusy: boolean;
  readonly agentActive: boolean;
};

export type CloudSyncPullResult = {
  readonly rev: number;
};

export type CloudSyncPushRequest = {
  readonly forceOverwriteRemote?: boolean;
};

export type CloudSyncPushResult = {
  readonly rev: number;
};

export type ShellMenuId = "file" | "edit" | "view" | "window" | "help";

export type ShellMenuPopupRequest = {
  readonly menuId: ShellMenuId;
  readonly x: number;
  readonly y: number;
};
