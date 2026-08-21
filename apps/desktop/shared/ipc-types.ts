/**
 * IPC channel names and serializable DTOs shared by main, preload, and renderer.
 * Single source of truth — handlers must not invent ad-hoc channel strings.
 */

export const IPC_CHANNELS = {
  BOOTSTRAP_STATUS: 'nm:bootstrap/status',
  BOOTSTRAP_REBOOTSTRAP: 'nm:bootstrap/rebootstrap',
  AGENT_STREAM: 'nm:agent-stream',
  /** Main → renderer：agentActive refcount 变化（工具卡「执行中」等） */
  AGENT_ACTIVITY: 'nm:agent/activity',
  AGENT_ACTIVITY_GET: 'nm:agent/activity/get',
  /** Main → renderer：VFS / worktree 可视变更通知（消费方 ① 刷新 Explorer） */
  WORKSPACE_MUTATED: 'nm:workspace/mutated',
  /** Main → renderer：规则差集 → Composer workplace 附件建议（不含 workspaceMutated） */
  COMPOSER_ATTACHMENTS_SUGGEST: 'nm:composer/attachmentsSuggest',
  /** Main → renderer：用户消息已 append（清 annotate；勿与 started/RUN_* 混用） */
  AGENT_USER_MESSAGE_APPENDED: 'nm:agent/userMessageAppended',

  SCOPE_GET: 'nm:scope/get',
  SCOPE_SET_PROJECT: 'nm:scope/setProject',
  SCOPE_SET_SESSION: 'nm:scope/setSession',

  PROJECTS_LIST: 'nm:projects/list',
  PROJECTS_CREATE: 'nm:projects/create',
  PROJECTS_RENAME: 'nm:projects/rename',
  PROJECTS_DELETE: 'nm:projects/delete',
  PROJECTS_GET_AGENT_CONFIG: 'nm:projects/getAgentConfig',
  PROJECTS_UPDATE_AGENT_CONFIG: 'nm:projects/updateAgentConfig',

  SESSIONS_LIST_BY_PROJECT: 'nm:sessions/listByProject',
  SESSIONS_CREATE: 'nm:sessions/create',
  SESSIONS_RENAME: 'nm:sessions/rename',
  SESSIONS_DELETE: 'nm:sessions/delete',
  SESSIONS_GET_COMPOSER_DRAFT: 'nm:sessions/getComposerDraft',
  SESSIONS_SET_COMPOSER_DRAFT: 'nm:sessions/setComposerDraft',
  SESSIONS_PROJECT_COMPOSER_STATUS: 'nm:sessions/projectComposerStatus',
  /** 会话级：读取当前会话的智能体绑定（follow / bind）。 */
  SESSIONS_GET_AGENT_BINDING: 'nm:sessions/getAgentBinding',
  /** 会话级：绑定 agent 到会话（agentId=null 解绑回 follow）。 */
  SESSIONS_SET_AGENT_BINDING: 'nm:sessions/setAgentBinding',
  /** 会话级：覆盖模型（modelId=null 清除覆盖，mode/agentId 保持现状）。 */
  SESSIONS_SET_MODEL_OVERRIDE: 'nm:sessions/setModelOverride',

  APP_UI_GET: 'nm:app-ui/get',
  APP_UI_SET: 'nm:app-ui/set',

  VFS_LIST: 'nm:vfs/list',
  VFS_READ: 'nm:vfs/read',
  /** 只读物理树浏览（跨域拼接视图；仅 list/read，无任何写通道） */
  PHYSICAL_LIST: 'nm:physical/list',
  PHYSICAL_READ: 'nm:physical/read',
  VFS_WRITE: 'nm:vfs/write',
  VFS_MKDIR: 'nm:vfs/mkdir',
  VFS_DELETE: 'nm:vfs/delete',
  VFS_RENAME: 'nm:vfs/rename',
  VFS_ZIP_EXPORT: 'nm:vfs/zipExport',
  VFS_ZIP_IMPORT: 'nm:vfs/zipImport',
  /** 弹框选 zip 读字节（技能导入预检用，预检在 Renderer） */
  VFS_ZIP_PICK: 'nm:vfs/zipPick',
  /** 字节直写导入（不弹框；技能新建弹窗创建时整包落盘用） */
  VFS_ZIP_IMPORT_BYTES: 'nm:vfs/zipImportBytes',
  /** 角色卡导入（PNG/JSON → 子树替换） */
  VFS_CHARACTER_CARD_IMPORT: 'nm:vfs/characterCardImport',
  /** 本机路径批量 ingest（plan + 可选 apply） */
  VFS_BATCH_INGEST_FROM_PATHS: 'nm:vfs/batchIngestFromPaths',
  /** 导出物化到临时目录（供 startDrag） */
  VFS_BATCH_EXPORT_STAGE: 'nm:vfs/batchExportStage',
  /** 清理 export staging 临时目录（dragEnd / 取消 / 失败） */
  VFS_BATCH_CLEAR_STAGING: 'nm:vfs/batchClearStaging',
  /** Main：webContents.startDrag（preload send，非 invoke） */
  VFS_START_DRAG: 'nm:vfs/startDrag',
  /** Main → renderer：startDrag 失败（send 无回传，经事件 toast） */
  VFS_START_DRAG_FAILED: 'nm:vfs/startDragFailed',

  WORKPLACE_BUILD_LIST_ROWS: 'nm:workplace/buildListRows',
  WORKPLACE_SET_DIR_RULE: 'nm:workplace/setDirRule',
  WORKPLACE_SET_FILE_RULE: 'nm:workplace/setFileRule',
  WORKPLACE_GET_DIR_RULE: 'nm:workplace/getDirRule',
  WORKPLACE_CAPTURE_SESSION_BLOCK: 'nm:workplace/captureSessionBlock',

  SESSIONS_PULL_TEMPLATE: 'nm:sessions/pullTemplate',

  MESSAGES_LIST: 'nm:messages/list',
  MESSAGES_APPEND: 'nm:messages/append',
  MESSAGES_EDIT: 'nm:messages/edit',
  MESSAGES_HIDE: 'nm:messages/hide',
  MESSAGES_SHOW: 'nm:messages/show',
  MESSAGES_HIDE_RANGE: 'nm:messages/hideRange',
  MESSAGES_SHOW_RANGE: 'nm:messages/showRange',
  MESSAGES_TRUNCATE_AFTER: 'nm:messages/truncateAfter',
  MESSAGES_DELETE: 'nm:messages/delete',
  MESSAGES_FORK: 'nm:messages/fork',
  MESSAGES_ROLLBACK: 'nm:messages/rollback',
  MESSAGES_SET_FLOOR: 'nm:messages/setFloor',
  MESSAGES_APPEND_TOOL_TURN_BRIDGE: 'nm:messages/appendToolTurnBridge',
  MESSAGES_SEARCH: 'nm:messages/search',

  AGENT_RUN: 'nm:agent/run',
  AGENT_ABORT: 'nm:agent/abort',
  AGENT_RUN_IS_ACTIVE: 'nm:agent/runIsActive',
  AGENT_RESOLVE_CURRENT: 'nm:agent/resolveCurrent',
  AGENT_LIST_PICKER: 'nm:agent/listPicker',
  AGENT_SET_CURRENT: 'nm:agent/setCurrent',

  MODEL_LIST_PICKER: 'nm:model/listPicker',
  MODEL_SET_CURRENT: 'nm:model/setCurrent',

  PROMPT_REAL_PREVIEW: 'nm:prompt/realPreview',
  PROMPT_CHAT_TOKEN_LABEL: 'nm:prompt/chatTokenLabel',
  PROMPT_AGENT_META: 'nm:prompt/agentMeta',

  COMPACTION_MANUAL: 'nm:compaction/manual',

  PREFERENCES_GET_SESSION_FS_VERSION_CHECK:
    'nm:preferences/getSessionFsVersionCheck',
  PREFERENCES_SET_SESSION_FS_VERSION_CHECK:
    'nm:preferences/setSessionFsVersionCheck',
  PREFERENCES_GET_LLM_STREAM: 'nm:preferences/getLlmStream',
  PREFERENCES_SET_LLM_STREAM: 'nm:preferences/setLlmStream',

  PROVIDERS_LIST: 'nm:providers/list',
  PROVIDERS_GET: 'nm:providers/get',
  PROVIDERS_CREATE: 'nm:providers/create',
  PROVIDERS_EDIT: 'nm:providers/edit',
  PROVIDERS_DELETE: 'nm:providers/delete',

  PROVIDER_MODELS_SAVED_LIST: 'nm:providerModels/savedList',
  PROVIDER_MODELS_FETCH: 'nm:providerModels/fetch',
  PROVIDER_MODELS_SUGGEST_LIST: 'nm:providerModels/suggestList',
  PROVIDER_MODELS_SAVE: 'nm:providerModels/save',
  PROVIDER_MODELS_DELETE_SAVED: 'nm:providerModels/deleteSaved',
  PROVIDER_MODELS_GET_SAVED: 'nm:providerModels/getSaved',
  PROVIDER_MODELS_UPDATE_SETTINGS: 'nm:providerModels/updateSettings',
  PROVIDER_MODELS_RESET_CONTEXT_WINDOW: 'nm:providerModels/resetContextWindow',
  PROVIDER_MODELS_EDIT_SAVED: 'nm:providerModels/editSaved',

  AGENT_REGISTRY_LIST: 'nm:agentRegistry/list',
  AGENT_REGISTRY_GET: 'nm:agentRegistry/get',
  AGENT_REGISTRY_UPSERT: 'nm:agentRegistry/upsert',
  AGENT_REGISTRY_DELETE: 'nm:agentRegistry/delete',
  AGENT_REGISTRY_CREATE_BLANK: 'nm:agentRegistry/createBlank',

  AGENT_YAML_EXPORT: 'nm:agentYaml/export',
  AGENT_YAML_IMPORT: 'nm:agentYaml/import',


  REGEX_LIST_GROUPS: 'nm:regex/listGroups',
  REGEX_GET_GROUP: 'nm:regex/getGroup',
  REGEX_CREATE_GROUP: 'nm:regex/createGroup',
  REGEX_UPDATE_GROUP: 'nm:regex/updateGroup',
  REGEX_DELETE_GROUP: 'nm:regex/deleteGroup',
  REGEX_LIST_RULES: 'nm:regex/listRules',
  REGEX_GET_RULE: 'nm:regex/getRule',
  REGEX_CREATE_RULE: 'nm:regex/createRule',
  REGEX_UPDATE_RULE: 'nm:regex/updateRule',
  REGEX_DELETE_RULE: 'nm:regex/deleteRule',
  REGEX_LIST_PICKER: 'nm:regex/listPicker',
  REGEX_SET_CURRENT: 'nm:regex/setCurrent',

  SKILLS_LIST: 'nm:skills/list',
  SKILLS_EFFECTIVE: 'nm:skills/effective',
  SKILLS_READ: 'nm:skills/read',
  SKILLS_WRITE: 'nm:skills/write',
  SKILLS_EDIT: 'nm:skills/edit',
  SKILLS_TOGGLE: 'nm:skills/toggle',
  SKILLS_DELETE: 'nm:skills/delete',

  COMPACTION_CONDITIONS_GET: 'nm:compactionConditions/get',
  COMPACTION_CONDITIONS_SET: 'nm:compactionConditions/set',

  BACKUP_EXPORT: 'nm:backup/export',
  BACKUP_IMPORT: 'nm:backup/import',

  CLOUD_SYNC_GET_CONFIG: 'nm:cloud-sync/getConfig',
  CLOUD_SYNC_SET_CONFIG: 'nm:cloud-sync/setConfig',
  CLOUD_SYNC_SET_ENABLED: 'nm:cloud-sync/setEnabled',
  CLOUD_SYNC_TEST_CONNECTION: 'nm:cloud-sync/testConnection',
  CLOUD_SYNC_GET_LOCAL_STATUS: 'nm:cloud-sync/getLocalStatus',
  CLOUD_SYNC_PULL: 'nm:cloud-sync/pull',
  CLOUD_SYNC_PUSH: 'nm:cloud-sync/push',

  SHELL_MENU_POPUP: 'nm:shell/menuPopup',
  SHELL_SET_TITLEBAR_THEME: 'nm:shell/setTitleBarTheme',
  SHELL_OPEN_EXTERNAL: 'nm:shell/openExternal',

  APP_GET_INFO: 'nm:app/getInfo',
  APP_CHECK_FOR_UPDATES: 'nm:app/checkForUpdates',
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
  readonly status: 'ready';
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
  /** 父会话 id；task 工具派生的子会话挂主会话 id，顶层会话为 null。 */
  readonly parentSessionId: string | null;
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
export type ProjectAgentModeDto = 'follow' | 'custom';

/**
 * IPC 可序列化的 Agent 定义（与领域 AgentDefinition 同构的 plain object）。
 * 禁 class / Map / 函数 / 不可克隆句柄。
 */
export type AgentDefinitionPlain = {
  readonly name: string;
  readonly prompts: unknown;
  readonly model?: string;
  readonly runtime?: {
    readonly maxSteps?: number;
    readonly doomLoopThreshold?: number;
    readonly doomLoopCrossRoundWindow?: number;
  };
  readonly tools?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
};

/** 项目智能体配置（IPC 传输；definition 为已评估 health）。 */
export type ProjectAgentConfigDto = {
  readonly mode: ProjectAgentModeDto;
  /** 有存储 definition 时附 assessed health；无草稿时省略。 */
  readonly definition?: StoredConfigHealthDto<AgentDefinitionPlain>;
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

export type SessionGetComposerDraftRequest = {
  readonly sessionId: string;
};

export type SessionSetComposerDraftRequest = {
  readonly sessionId: string;
  /** 原始 JSON；null 清空列。 */
  readonly draftJson: string | null;
};

export type SessionProjectComposerStatusRequest = {
  readonly sessionId: string;
};

/**
 * 会话级智能体配置 wire 形态（与 core 的 SessionAgentConfig 同型，避免双向映射）。
 *
 * - `agentId`：固定到 registry 中的 agent，必填（会话始终独立持有，不再 follow workspace）。
 * - `modelId`：可选，覆盖 agent pin 的模型。
 */
export type SessionAgentConfigDto = {
  readonly agentId: string;
  readonly modelId?: string;
};

export type SessionGetAgentBindingRequest = {
  readonly sessionId: string;
};

export type SessionSetAgentBindingRequest = {
  readonly sessionId: string;
  /**
   * `null` 表示将该会话的 agentId 同步为 workspace 当前 agent（作为该会话的新
   * 默认值）；会话始终持有 agentId，这不是解绑/回退，而是「同步到当前默认」。
   * 具体 id 直接写入会话。
   */
  readonly agentId: string | null;
};

export type SessionSetModelOverrideRequest = {
  readonly sessionId: string;
  /** `null` 表示清除模型覆盖；agentId 保持现状不动。 */
  readonly modelId: string | null;
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

export type UpdateCheckStatus = 'up-to-date' | 'update-available';

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
export type WorkspacePanelScope =
  | 'global'
  | 'session'
  | 'chat'
  | 'global-meta'
  | 'project-meta'
  /** 只读物理树浏览域（跨域拼接视图，不落单 scope；仅 list/read） */
  | 'physical';

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
  /** 子树目标目录；缺省 ≡ `/`（整域） */
  readonly directoryPath?: string;
};

export type VfsZipExportResult = 'saved' | 'cancelled';
export type VfsZipImportResult = 'imported' | 'cancelled';

/** zipPick 结果：所选文件字节；null = 用户取消。 */
export type VfsZipPickResult = Uint8Array | null;

/** 字节导入请求：选文件（zipPick）与确认（Renderer 预检）已前置，不再弹框。 */
export type VfsZipBytesImportRequest = VfsScopeRequest & {
  readonly bytes: Uint8Array;
  readonly confirmed?: boolean;
  /** 子树目标目录；缺省 ≡ `/`（整域） */
  readonly directoryPath?: string;
};

/** 角色卡导入请求：与 {@link VfsZipRequest} 同构（确认在 Renderer，选文件在 Main）。 */
export type VfsCharacterCardImportRequest = VfsScopeRequest & {
  readonly confirmed?: boolean;
  /** 子树目标目录；缺省 ≡ `/`（整域） */
  readonly directoryPath?: string;
};

export type VfsCharacterCardImportResult = 'imported' | 'cancelled';

export type VfsBatchConflictDto = {
  readonly logicalPath: string;
  readonly reason: 'exists';
};

export type VfsBatchApplyReportDto = {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: ReadonlyArray<{
    readonly path: string;
    readonly message: string;
  }>;
};

export type VfsBatchIngestFromPathsRequest = VfsScopeRequest & {
  readonly targetDir: string;
  readonly hostPaths: readonly string[];
  readonly overwriteConfirmed?: boolean;
};

export type VfsBatchIngestFromPathsResult =
  | {
      readonly status: 'needs_confirm';
      readonly conflicts: readonly VfsBatchConflictDto[];
      readonly skippedBinary: readonly string[];
    }
  | {
      readonly status: 'applied';
      readonly report: VfsBatchApplyReportDto;
      readonly skippedBinary: readonly string[];
    };

export type VfsBatchExportStageRequest = VfsScopeRequest & {
  readonly logicalPaths: readonly string[];
};

export type VfsBatchExportStageResult = {
  readonly stagingRoot: string;
  /** 供 startDrag 的顶层绝对路径（文件或目录） */
  readonly filePaths: readonly string[];
};

export type VfsBatchClearStagingRequest = {
  readonly stagingRoot: string;
};

export type VfsStartDragRequest = {
  readonly filePaths: readonly string[];
};

/** Main → renderer：startDrag 失败载荷（供 toast） */
export type VfsStartDragFailedPayload = {
  readonly message: string;
};

export type VfsListEntryDto = {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly version?: number;
  readonly mtimeMs?: number;
};

export type VfsReadResultDto = {
  readonly content: string;
  readonly version: number;
  readonly mtimeMs: number;
};

export type WorkplaceRuleState = 'rule_on' | 'rule_off';

export type WorkplaceInclusionMode = 'auto' | 'show' | 'hide';

export type WorkplaceDisplayState = 'hidden' | 'full' | 'header' | 'filename';

export type WorkplaceListRowDto =
  | {
      readonly kind: 'dir';
      readonly path: string;
      readonly ruleState: WorkplaceRuleState;
      /** 展示名（物理树合成目录行的项目名/会话名）；未填充时用路径末段。 */
      readonly label?: string;
    }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly inclusionMode: WorkplaceInclusionMode;
      readonly displayState: WorkplaceDisplayState;
    };

export type WorkplaceBuildListRowsRequest = VfsScopeRequest;

/**
 * 只读物理树列目录请求：列 `path` 子树全部行（BFS 收敛）。
 * 行 DTO 复用 {@link WorkplaceListRowDto}；规则类字段（ruleState /
 * inclusionMode / displayState）对物理树无意义，恒为缺省值。
 */
export type PhysicalListRequest = {
  readonly path: string;
};

/** 只读物理树读文件请求：前缀解析后走对应域单 scope read。 */
export type PhysicalReadRequest = {
  readonly path: string;
};

export type WorkplaceSetDirRuleRequest = VfsScopeRequest & {
  readonly logicalPath: string;
  readonly ruleEnabled?: boolean;
  readonly sortField?: 'name' | 'created' | 'updated';
  readonly sortOrder?: 'asc' | 'desc';
  readonly headCount?: number;
  readonly tailCount?: number;
  readonly fillPolicy?: 'hidden' | 'filename' | 'header';
};

export type WorkplaceSetFileRuleRequest = VfsScopeRequest & {
  readonly logicalPath: string;
  readonly inclusionMode: 'auto' | 'show' | 'hide';
};

export type WorkplaceGetDirRuleRequest = VfsScopeRequest & {
  readonly logicalPath: string;
};

/** 手动重置常驻工作区缓存（清空 session kkv，下次拼装重建）。 */
export type WorkplaceCaptureSessionBlockRequest = {
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

export type SessionPullTemplateRequest = {
  readonly sessionId: string;
};

export type MessagesListRequest = {
  readonly sessionId: string;
};

/** 聊天记录查询入参，透传 core 的 MessageSearchQuery。 */
export interface MessagesSearchRequest {
  readonly sessionId: string;
  readonly keyword?: string;
  readonly limit: number;
  readonly beforeSeq?: number;
  /** 区间下界（闭区间，含 hidden 消息）：为空/undefined 时不设下界。 */
  readonly fromSeq?: number;
  /** 区间上界（闭区间，含 hidden 消息）：为空/undefined 时不设上界。 */
  readonly toSeq?: number;
}

export type ContentBlockDto =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly type: 'tool_result';
      readonly toolUseId: string;
      readonly content: string;
      readonly ok?: boolean;
      readonly summary?: string;
      /**
       * UI-only 旁路字段：task 工具携带 `subagentSessionId` 供卡片跳转子会话；
       * skill 携带 `skillRef`（read 由工具输出解析透传，write/edit 由输入侧解析）。
       */
      readonly meta?: {
        readonly subagentSessionId?: string;
        readonly skillRef?: {
          readonly domain: 'global' | 'project';
          readonly projectId?: string;
          readonly name: string;
        };
      };
    };

/** 会话消息 synthetic 元数据（对应 core `MessageMetadata`）。 */
export type MessageMetadataDto = {
  readonly source?: 'user';
  readonly actor?: 'user';
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
  /** 结构化附件；与 Core `ChatMessage.attachments` 对齐。 */
  readonly attachments?: readonly MessageAttachmentDto[];
};

export type MessagesAppendRequest = {
  readonly sessionId: string;
  readonly role: 'user' | 'assistant' | 'system';
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

export type MessagesSetFloorPayload = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messageId: string;
};

export type MessagesSetFloorResult = {
  readonly hiddenCount: number;
  readonly shownCount: number;
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
  /** Composer 附件；当前仅 `source===attach` 生效（Core 发送时再扫描合并 `@path`）。workplace/user_ops 为历史只读兼容。 */
  readonly attachments?: readonly MessageAttachmentDto[];
  /** 本轮未发送批注草稿；main 透传至 Core `runAgentTurn`。 */
  readonly annotateDrafts?: readonly AnnotateDraftDto[];
};

export type AgentAbortRequest = {
  readonly sessionId: string;
};

/**
 * renderer 查询某 session 是否有 in-flight run 的请求体；
 * main 侧转调 rt.abortRegistry.has(sessionId)。
 */
export type AgentRunIsActiveRequest = {
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
  readonly source: 'session' | 'none';
  readonly agentId?: string;
  readonly agentName: string;
  readonly modelLabel: string;
  readonly hasDedicatedModel: boolean;
  /**
   * 模型来源优先级链（项目智能体已下线，会话始终走 session 级）：
   * - `agent-pin`：agent definition 自带 model，压制 session 覆盖。
   * - `session`：会话级 modelId（agent 无 pin 时生效）。
   * `source: 'none'` 时省略。
   */
  readonly modelSource?: 'agent-pin' | 'session';
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

/** 与 Core `MessageAttachmentAction` 对齐。 */
export type MessageAttachmentActionDto =
  | 'delete'
  | 'write'
  | 'edit'
  | 'mkdir'
  | 'rename'
  | 'move'
  | 'workplaceChange'
  | 'userAttach'
  | 'annotate'
  | 'skillAttach';

/** 与 Core `MessageAttachment` 对齐的 IPC DTO（renderer 不直接依赖 core）。 */
export type MessageAttachmentDto = {
  readonly name: string;
  readonly source: 'workplace' | 'attach' | 'user_ops';
  readonly type: 'text' | 'image' | 'dir';
  readonly content: string | null;
  readonly path?: string;
  /** skillAttach 专用：技能名（无 path，chip 文案以此为准）。 */
  readonly skillName?: string;
  /** 结构化 action；新写入应带；历史可缺省。 */
  readonly action?: MessageAttachmentActionDto;
};

/** 与 Core `AnnotateDraft` 对齐（App → main → runAgentTurn）。 */
export type AnnotateDraftDto = {
  readonly id: string;
  readonly path: string;
  /** Recogito quote（划词原文）。 */
  readonly originalText: string;
  readonly userAnnotation: string;
  /**
   * MD 渲染正文 / Recogito 容器坐标系半开起点（UTF-16；`[renderStart, renderEnd)`）。
   * 新稿必写；缺省兼容仅有旧 VFS offset 的存量草稿。
   */
  readonly renderStart?: number;
  /** MD 渲染正文 / Recogito 容器坐标系半开终点（不含）。 */
  readonly renderEnd?: number;
  /**
   * 旧 VFS soft offset 起点（UTF-16；相对 VFS 全文；`[startOffset, endOffset)`）。
   * 非预览投影权威；缺省兼容旧草稿。
   */
  readonly startOffset?: number;
  /** 旧 VFS soft offset 终点（不含）；非预览投影权威。 */
  readonly endOffset?: number;
  /** 宽松窗口起始行（1-based，含）；由 offset 派生；非预览投影权威。 */
  readonly startLine?: number;
  /** 宽松窗口结束行（1-based，含）；非预览投影权威。 */
  readonly endLine?: number;
  /** 起始列（1-based，含）；缺省表示自行首；非预览投影权威。 */
  readonly startCol?: number;
  /** 结束列（1-based，含）；缺省表示至行尾；非预览投影权威。 */
  readonly endCol?: number;
};

/**
 * Composer 附件建议推送载荷。
 * 该通道已废止：workplace 差集不再推送（workplace 改走常驻前缀 S0，不再生成附件）。
 * 类型保留以兼容历史 IPC 读取；新代码不应再向 renderer 推送 workplace 差集。
 * 职责与 {@link WorkspaceMutatedPayload} 分离，禁止塞进 workspaceMutated。
 */
export type ComposerAttachmentsSuggestPayload = {
  readonly sessionId: string;
  readonly attachments: readonly MessageAttachmentDto[];
};

/** Main → renderer：用户消息 append 成功（清 annotate store）。 */
export type AgentUserMessageAppendedPayload = {
  readonly sessionId: string;
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
  readonly displayName: string;
  readonly protocol: string;
  readonly baseUrl: string;
  readonly isBuiltin: boolean;
  readonly apiKeyStatus: 'set' | 'not set';
  readonly savedCount: number;
};

export type ProviderDetailDto = {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: string;
  readonly baseUrl: string;
  readonly isBuiltin: boolean;
  readonly headers: Record<string, string>;
  readonly apiKeyStatus: 'set' | 'not set';
};

export type ProviderCreateRequest = {
  readonly protocol: 'openai' | 'anthropic' | 'gemini';
  readonly baseUrl: string;
  /** 必填：服务商对人名称。 */
  readonly displayName: string;
  readonly apiKey: string;
  readonly headers?: Record<string, string>;
};

export type ProviderEditRequest = {
  readonly providerId: string;
  readonly protocol?: 'openai' | 'anthropic' | 'gemini';
  readonly baseUrl?: string;
  /** 若出现则 trim 后必须非空。 */
  readonly displayName?: string;
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
  readonly thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
};

export type ProviderModelsResetContextWindowRequest = {
  readonly savedModelId: string;
};

/** 存储配置失效摘要（列表/编辑 assess 结果）。 */
export type StoredConfigInvalidDto = {
  readonly code: 'outdated_version' | 'broken_wire' | 'removed_feature';
  readonly message: string;
  readonly storedSchemaVersion?: number;
};

/**
 * 与 core `StoredConfigHealth<T>` 同构的 IPC discriminated union。
 * `value` 须为可结构化克隆的 plain object。
 */
export type StoredConfigHealthDto<TValue extends object> =
  | { readonly status: 'valid'; readonly value: TValue }
  | ({ readonly status: 'invalid' } & StoredConfigInvalidDto);

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

/**
 * Agent get：main 侧 assess 后返回 health；附带原始 wire（invalid 时用于尽力读显示名）。
 */
export type AgentRegistryGetResponse = StoredConfigHealthDto<AgentDefinitionPlain> & {
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
  readonly rule: Omit<RegexRuleDto, 'ruleId'> & { readonly ruleId?: string };
};

export type RegexUpdateRuleRequest = RegexRuleIdRequest & {
  readonly patch: Partial<Omit<RegexRuleDto, 'ruleId'>>;
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

/** 技能归属域（与 core `SkillDomain` 对齐；renderer 不直接依赖 core）。 */
export type SkillDomainDto = 'global' | 'project';

/** 技能定位引用（跳详情 / 卡片透传 / copy-delete 入参）。 */
export type SkillRefDto = {
  readonly domain: SkillDomainDto;
  /** project 域必带；global 域缺省。 */
  readonly projectId?: string;
  readonly name: string;
};

/** 技能清单条目（listSkills）：front matter 元数据 + 有效性 + 文件列表。 */
export type SkillListItemDto = {
  readonly name: string;
  readonly description: string | null;
  readonly domain: SkillDomainDto;
  readonly valid: boolean;
  readonly invalidReason?: string;
  /** 相对技能目录的文件路径（含 SKILL.md，若有）。 */
  readonly files: readonly string[];
};

/** 合并视图条目（effectiveSkills）：同名项目副本覆盖 global、负名单标记。 */
export type EffectiveSkillDto = {
  readonly name: string;
  readonly description: string | null;
  readonly domain: SkillDomainDto;
  /** project 副本覆盖同名 global 技能时为 true。 */
  readonly overridden: boolean;
  /** 命中当前项目负清单时为 true（显式 `$` 引用仍允许）。 */
  readonly disabled: boolean;
  readonly valid: boolean;
  readonly invalidReason?: string;
  /** valid && !disabled：计入索引 / `$` 候选 / 启用统计。 */
  readonly effective: boolean;
};

/** 清单查询域：global 全局域，或某个项目域。 */
export type SkillsListRequest = {
  readonly domain: SkillDomainDto;
  /** domain === 'project' 时必带。 */
  readonly projectId?: string;
};

export type SkillsEffectiveRequest = {
  readonly projectId: string;
};

/**
 * 读取技能文件。`domain` 缺省按生效副本解析（同名项目副本优先，
 * `projectId` 提供解析上下文）；显式传 domain 时读对应域原件。
 */
export type SkillsReadRequest = {
  readonly domain?: SkillDomainDto;
  readonly name: string;
  /** 相对技能目录，缺省 SKILL.md。 */
  readonly path?: string;
  readonly projectId?: string;
};

export type SkillsReadResponse = {
  /** 实际命中的域（生效副本解析后）。 */
  readonly domain: SkillDomainDto;
  readonly name: string;
  readonly path: string;
  readonly content: string;
  readonly version: number;
};

/** 写技能文件（整文件覆盖）；新建技能 = 写新目录的 SKILL.md。 */
export type SkillsWriteRequest = {
  /** 写入必须显式域（core 缺域报错）。 */
  readonly domain?: SkillDomainDto;
  readonly name: string;
  readonly path?: string;
  readonly content: string;
  readonly projectId?: string;
  /** 编辑已存在文件时传 read 返回的版本（VFS 乐观锁）；新建文件不传。 */
  readonly version?: number;
};

/** 局部修改（同 edit 工具的 normalize-for-match 语义）；须显式域。 */
export type SkillsEditRequest = {
  readonly domain?: SkillDomainDto;
  readonly name: string;
  readonly path?: string;
  readonly projectId?: string;
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll?: boolean;
};

/** 负清单读写：只写当前项目的禁用记录。 */
export type SkillsToggleRequest = {
  readonly projectId: string;
  readonly name: string;
  readonly disabled: boolean;
};

export type SkillsDeleteRequest = SkillRefDto;

export type CompactionConditionsDto = {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
  /** hide-message 起始深度（tail 0 = newest），缺省由 core 按 6 处理。 */
  readonly hideStartDepth?: number;
};

export type CompactionConditionsSetRequest = {
  readonly conditions: CompactionConditionsDto;
};

export type BackupExportResult = 'saved' | 'cancelled';
export type BackupImportResult = 'imported' | 'cancelled';

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

export type ShellMenuId = 'file' | 'edit' | 'view' | 'window' | 'help';

export type ShellMenuPopupRequest = {
  readonly menuId: ShellMenuId;
  readonly x: number;
  readonly y: number;
};
