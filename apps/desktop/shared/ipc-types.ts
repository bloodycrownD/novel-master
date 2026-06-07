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

  SESSION_FS_EXECUTE: "nm:sessionFs/execute",
  SESSION_FS_ROLLBACK: "nm:sessionFs/rollback",

  PROJECTS_PULL_TEMPLATE: "nm:projects/pullTemplate",
  SESSIONS_PULL_TEMPLATE: "nm:sessions/pullTemplate",

  MESSAGES_LIST: "nm:messages/list",
  MESSAGES_APPEND: "nm:messages/append",
  MESSAGES_EDIT: "nm:messages/edit",
  MESSAGES_HIDE: "nm:messages/hide",
  MESSAGES_SHOW: "nm:messages/show",
  MESSAGES_DELETE: "nm:messages/delete",
  MESSAGES_FORK: "nm:messages/fork",
  MESSAGES_ROLLBACK: "nm:messages/rollback",

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
  PREFERENCES_GET_SHOW_FULL_TOOL_PARAMS:
    "nm:preferences/getShowFullToolParams",
  PREFERENCES_SET_SHOW_FULL_TOOL_PARAMS:
    "nm:preferences/setShowFullToolParams",
  PREFERENCES_GET_CHECKPOINT_RETENTION:
    "nm:preferences/getCheckpointRetention",
  PREFERENCES_SET_CHECKPOINT_RETENTION:
    "nm:preferences/setCheckpointRetention",

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

  SHELL_MENU_POPUP: "nm:shell/menuPopup",
  SHELL_SET_TITLEBAR_THEME: "nm:shell/setTitleBarTheme",
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

export type SessionFsExecuteRequest = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly actions: ReadonlyArray<
    | { readonly function: "read"; readonly path: string }
    | { readonly function: "write"; readonly path: string; readonly content: string }
    | { readonly function: "delete"; readonly path: string }
  >;
  readonly actor: "user" | "assistant" | "system";
  readonly expectedVersion?: number;
  readonly versionCheck?: boolean;
};

export type SessionFsRollbackRequest = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messageId: string;
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

export type MessagesDeleteRequest = {
  readonly messageId: string;
};

export type MessagesForkRequest = {
  readonly sessionId: string;
  readonly messageId: string;
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
  readonly applicationModelId: string;
  readonly label: string;
};

export type ModelListPickerResponse = {
  readonly rows: readonly ModelPickerRowDto[];
  readonly currentId: string | undefined;
};

export type ModelSetCurrentRequest = {
  readonly applicationModelId: string;
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
  readonly agentId: string | undefined;
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

export type PreviewFileSelection = {
  readonly workspaceScope: WorkspacePanelScope;
  readonly path: string;
  readonly name: string;
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
  readonly vendorModelId: string;
  readonly displayName: string;
  readonly applicationModelId: string;
};

export type ProviderModelsSavedListRequest = ProviderIdRequest;

export type ProviderModelsFetchRequest = ProviderIdRequest;

export type ProviderModelsSaveRequest = ProviderIdRequest & {
  readonly vendorModelId: string;
  readonly displayName?: string;
};

export type ProviderModelsDeleteSavedRequest = ProviderIdRequest & {
  readonly vendorModelId: string;
};

export type ProviderModelsGetSavedRequest = {
  readonly applicationModelId: string;
};

export type ProviderModelsUpdateSettingsRequest = ProviderIdRequest & {
  readonly vendorModelId: string;
  readonly contextWindowTokens: number;
  readonly tokenCounterMode: string;
  readonly sampling: unknown;
};

export type ProviderModelsResetContextWindowRequest = ProviderIdRequest & {
  readonly vendorModelId: string;
};

export type AgentRegistryListItemDto = {
  readonly agentId: string;
  readonly name: string;
};

export type AgentRegistryGetRequest = {
  readonly agentId: string;
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

export type ShellMenuId = "file" | "edit" | "view" | "window" | "help";

export type ShellMenuPopupRequest = {
  readonly menuId: ShellMenuId;
  readonly x: number;
  readonly y: number;
};
