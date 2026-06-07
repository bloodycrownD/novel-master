/**
 * Renderer-side IPC client — thin wrapper over preload bridge.
 */
import {
  IPC_CHANNELS,
  type AgentAbortRequest,
  type AgentListPickerResponse,
  type AgentResolveCurrentResponse,
  type AgentRunRequest,
  type AgentSetCurrentRequest,
  type AgentStreamEventPayload,
  type AppUiGetResponse,
  type BootstrapStatusResponse,
  type ChatMessageDto,
  type CompactionManualRequest,
  type IpcResult,
  type MessagesAppendRequest,
  type MessagesDeleteRequest,
  type MessagesEditRequest,
  type MessagesForkRequest,
  type MessagesHideRequest,
  type MessagesListRequest,
  type MessagesShowRequest,
  type ModelListPickerResponse,
  type ModelSetCurrentRequest,
  type ProjectCreateRequest,
  type ProjectDeleteRequest,
  type ProjectDto,
  type ProjectPullTemplateRequest,
  type ProjectRenameRequest,
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
  type SessionListByProjectRequest,
  type SessionPullTemplateRequest,
  type SessionRenameRequest,
  type VfsDeleteRequest,
  type VfsListRequest,
  type VfsMkdirRequest,
  type VfsReadRequest,
  type VfsReadResultDto,
  type VfsRenameRequest,
  type VfsScopeRequest,
  type VfsWriteRequest,
  type VfsZipExportResult,
  type VfsZipImportResult,
  type VfsZipRequest,
  type WorktreeBuildListRowsRequest,
  type WorktreeGetDirRuleRequest,
  type WorktreeListRowDto,
  type WorktreeSetDirRuleRequest,
  type WorktreeSetFileRuleRequest,
} from "../../shared/ipc-types.js";

function bridge() {
  if (!window.novelMasterDesktop) {
    const inBrowser =
      typeof navigator !== "undefined" && !/Electron/i.test(navigator.userAgent);
    throw new Error(
      inBrowser
        ? "novelMasterDesktop 仅在 Electron 中可用。请运行 npm run desktop:dev，不要直接在浏览器打开 localhost:5173。"
        : "novelMasterDesktop preload bridge is unavailable（preload 未加载，请重新 build 后启动 Electron）",
    );
  }
  return window.novelMasterDesktop;
}

export function getDesktopBridge() {
  return bridge();
}

export async function getBootstrapStatus(): Promise<BootstrapStatusResponse> {
  return bridge().invoke<BootstrapStatusResponse>(IPC_CHANNELS.BOOTSTRAP_STATUS);
}

export async function rebootstrap(): Promise<BootstrapStatusResponse> {
  return bridge().invoke<BootstrapStatusResponse>(
    IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP,
  );
}

export function onAgentStream(
  callback: (payload: AgentStreamEventPayload) => void,
): () => void {
  return bridge().on(IPC_CHANNELS.AGENT_STREAM, callback as (p: unknown) => void);
}

export async function ipcScopeGet(): Promise<IpcResult<ScopeSnapshotDto>> {
  return bridge().invoke<IpcResult<ScopeSnapshotDto>>(IPC_CHANNELS.SCOPE_GET);
}

export async function ipcScopeSetProject(
  req: ScopeSetProjectRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  return bridge().invoke<IpcResult<ScopeSnapshotDto>>(
    IPC_CHANNELS.SCOPE_SET_PROJECT,
    req,
  );
}

export async function ipcScopeSetSession(
  req: ScopeSetSessionRequest,
): Promise<IpcResult<ScopeSnapshotDto>> {
  return bridge().invoke<IpcResult<ScopeSnapshotDto>>(
    IPC_CHANNELS.SCOPE_SET_SESSION,
    req,
  );
}

export async function ipcProjectsList(): Promise<IpcResult<ProjectDto[]>> {
  return bridge().invoke<IpcResult<ProjectDto[]>>(IPC_CHANNELS.PROJECTS_LIST);
}

export async function ipcProjectsCreate(
  req: ProjectCreateRequest,
): Promise<IpcResult<ProjectDto>> {
  return bridge().invoke<IpcResult<ProjectDto>>(
    IPC_CHANNELS.PROJECTS_CREATE,
    req,
  );
}

export async function ipcProjectsRename(
  req: ProjectRenameRequest,
): Promise<IpcResult<ProjectDto>> {
  return bridge().invoke<IpcResult<ProjectDto>>(
    IPC_CHANNELS.PROJECTS_RENAME,
    req,
  );
}

export async function ipcProjectsDelete(
  req: ProjectDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke<IpcResult<void>>(IPC_CHANNELS.PROJECTS_DELETE, req);
}

export async function ipcSessionsListByProject(
  req: SessionListByProjectRequest,
): Promise<IpcResult<SessionDto[]>> {
  return bridge().invoke<IpcResult<SessionDto[]>>(
    IPC_CHANNELS.SESSIONS_LIST_BY_PROJECT,
    req,
  );
}

export async function ipcSessionsCreate(
  req: SessionCreateRequest,
): Promise<IpcResult<SessionDto>> {
  return bridge().invoke<IpcResult<SessionDto>>(
    IPC_CHANNELS.SESSIONS_CREATE,
    req,
  );
}

export async function ipcSessionsRename(
  req: SessionRenameRequest,
): Promise<IpcResult<SessionDto>> {
  return bridge().invoke<IpcResult<SessionDto>>(
    IPC_CHANNELS.SESSIONS_RENAME,
    req,
  );
}

export async function ipcSessionsDelete(
  req: SessionDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke<IpcResult<void>>(IPC_CHANNELS.SESSIONS_DELETE, req);
}

export async function ipcAppUiGet(key: string): Promise<AppUiGetResponse> {
  return bridge().invoke<AppUiGetResponse>(IPC_CHANNELS.APP_UI_GET, { key });
}

export async function ipcAppUiSet(
  key: string,
  value: string,
): Promise<IpcResult<void>> {
  return bridge().invoke<IpcResult<void>>(IPC_CHANNELS.APP_UI_SET, {
    key,
    value,
  });
}

function vfsScope(
  workspaceScope: VfsScopeRequest["workspaceScope"],
  projectId?: string,
  sessionId?: string,
): VfsScopeRequest {
  return { workspaceScope, projectId, sessionId };
}

export async function ipcWorktreeBuildListRows(
  req: WorktreeBuildListRowsRequest,
): Promise<IpcResult<WorktreeListRowDto[]>> {
  return bridge().invoke(IPC_CHANNELS.WORKTREE_BUILD_LIST_ROWS, req);
}

export async function ipcWorktreeSetDirRule(
  req: WorktreeSetDirRuleRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.WORKTREE_SET_DIR_RULE, req);
}

export async function ipcWorktreeSetFileRule(
  req: WorktreeSetFileRuleRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.WORKTREE_SET_FILE_RULE, req);
}

export async function ipcWorktreeGetDirRule(
  req: WorktreeGetDirRuleRequest,
): Promise<IpcResult<WorktreeSetDirRuleRequest | null>> {
  return bridge().invoke(IPC_CHANNELS.WORKTREE_GET_DIR_RULE, req);
}

export async function ipcVfsRead(
  req: VfsReadRequest,
): Promise<IpcResult<VfsReadResultDto>> {
  return bridge().invoke(IPC_CHANNELS.VFS_READ, req);
}

export async function ipcVfsWrite(req: VfsWriteRequest): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.VFS_WRITE, req);
}

export async function ipcVfsMkdir(req: VfsMkdirRequest): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.VFS_MKDIR, req);
}

export async function ipcVfsDelete(
  req: VfsDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.VFS_DELETE, req);
}

export async function ipcVfsRename(
  req: VfsRenameRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.VFS_RENAME, req);
}

export async function ipcVfsZipExport(
  req: VfsZipRequest,
): Promise<IpcResult<VfsZipExportResult>> {
  return bridge().invoke(IPC_CHANNELS.VFS_ZIP_EXPORT, req);
}

export async function ipcVfsZipImport(
  req: VfsZipRequest,
): Promise<IpcResult<VfsZipImportResult>> {
  return bridge().invoke(IPC_CHANNELS.VFS_ZIP_IMPORT, req);
}

export async function ipcProjectsPullTemplate(
  req: ProjectPullTemplateRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.PROJECTS_PULL_TEMPLATE, req);
}

export async function ipcSessionsPullTemplate(
  req: SessionPullTemplateRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.SESSIONS_PULL_TEMPLATE, req);
}

export async function ipcMessagesList(
  req: MessagesListRequest,
): Promise<IpcResult<ChatMessageDto[]>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_LIST, req);
}

export async function ipcMessagesAppend(
  req: MessagesAppendRequest,
): Promise<IpcResult<ChatMessageDto>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_APPEND, req);
}

export async function ipcMessagesEdit(
  req: MessagesEditRequest,
): Promise<IpcResult<ChatMessageDto>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_EDIT, req);
}

export async function ipcMessagesHide(
  req: MessagesHideRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_HIDE, req);
}

export async function ipcMessagesShow(
  req: MessagesShowRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_SHOW, req);
}

export async function ipcMessagesDelete(
  req: MessagesDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_DELETE, req);
}

export async function ipcMessagesFork(
  req: MessagesForkRequest,
): Promise<IpcResult<SessionDto>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_FORK, req);
}

export async function ipcMessagesRollback(
  req: SessionFsRollbackRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_ROLLBACK, req);
}

export async function ipcAgentRun(
  req: AgentRunRequest,
): Promise<IpcResult<{ started: boolean }>> {
  return bridge().invoke(IPC_CHANNELS.AGENT_RUN, req);
}

export async function ipcAgentAbort(
  req: AgentAbortRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.AGENT_ABORT, req);
}

export async function ipcAgentResolveCurrent(): Promise<
  IpcResult<AgentResolveCurrentResponse>
> {
  return bridge().invoke(IPC_CHANNELS.AGENT_RESOLVE_CURRENT);
}

export async function ipcAgentListPicker(): Promise<
  IpcResult<AgentListPickerResponse>
> {
  return bridge().invoke(IPC_CHANNELS.AGENT_LIST_PICKER);
}

export async function ipcAgentSetCurrent(
  req: AgentSetCurrentRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.AGENT_SET_CURRENT, req);
}

export async function ipcModelListPicker(): Promise<
  IpcResult<ModelListPickerResponse>
> {
  return bridge().invoke(IPC_CHANNELS.MODEL_LIST_PICKER);
}

export async function ipcModelSetCurrent(
  req: ModelSetCurrentRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.MODEL_SET_CURRENT, req);
}

export async function ipcPromptRealPreview(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptPreviewSegmentDto[]>> {
  return bridge().invoke(IPC_CHANNELS.PROMPT_REAL_PREVIEW, req);
}

export async function ipcPromptChatTokenLabel(
  req: PromptScopeRequest,
): Promise<IpcResult<PromptChatTokenStatsResponse>> {
  return bridge().invoke(IPC_CHANNELS.PROMPT_CHAT_TOKEN_LABEL, req);
}

export async function ipcPromptAgentMeta(): Promise<
  IpcResult<PromptAgentMetaResponse>
> {
  return bridge().invoke(IPC_CHANNELS.PROMPT_AGENT_META);
}

export async function ipcCompactionManual(
  req: CompactionManualRequest,
): Promise<IpcResult<{ ok: boolean }>> {
  return bridge().invoke(IPC_CHANNELS.COMPACTION_MANUAL, req);
}

export async function ipcPreferencesGetSessionFsVersionCheck(): Promise<
  IpcResult<boolean>
> {
  return bridge().invoke(IPC_CHANNELS.PREFERENCES_GET_SESSION_FS_VERSION_CHECK);
}

export async function ipcPreferencesSetSessionFsVersionCheck(
  enabled: boolean,
): Promise<IpcResult<void>> {
  return bridge().invoke(
    IPC_CHANNELS.PREFERENCES_SET_SESSION_FS_VERSION_CHECK,
    enabled,
  );
}

export async function ipcPreferencesGetLlmStream(): Promise<IpcResult<boolean>> {
  return bridge().invoke(IPC_CHANNELS.PREFERENCES_GET_LLM_STREAM);
}

export async function ipcPreferencesSetLlmStream(
  enabled: boolean,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.PREFERENCES_SET_LLM_STREAM, enabled);
}

export async function ipcProvidersList() {
  return bridge().invoke(IPC_CHANNELS.PROVIDERS_LIST);
}

export async function ipcProvidersGet(req: { providerId: string }) {
  return bridge().invoke(IPC_CHANNELS.PROVIDERS_GET, req);
}

export async function ipcProvidersCreate(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.PROVIDERS_CREATE, req);
}

export async function ipcProvidersEdit(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.PROVIDERS_EDIT, req);
}

export async function ipcProvidersDelete(req: { providerId: string }) {
  return bridge().invoke(IPC_CHANNELS.PROVIDERS_DELETE, req);
}

export async function ipcProviderModelsSavedList(req: { providerId: string }) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_SAVED_LIST, req);
}

export async function ipcProviderModelsFetch(req: { providerId: string }) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_FETCH, req);
}

export async function ipcProviderModelsSuggestList(req: { providerId: string }) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_SUGGEST_LIST, req);
}

export async function ipcProviderModelsSave(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_SAVE, req);
}

export async function ipcProviderModelsDeleteSaved(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_DELETE_SAVED, req);
}

export async function ipcProviderModelsGetSaved(req: { applicationModelId: string }) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_GET_SAVED, req);
}

export async function ipcProviderModelsUpdateSettings(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_UPDATE_SETTINGS, req);
}

export async function ipcProviderModelsResetContextWindow(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.PROVIDER_MODELS_RESET_CONTEXT_WINDOW, req);
}

export async function ipcAgentRegistryList() {
  return bridge().invoke(IPC_CHANNELS.AGENT_REGISTRY_LIST);
}

export async function ipcAgentRegistryGet(req: { agentId: string }) {
  return bridge().invoke(IPC_CHANNELS.AGENT_REGISTRY_GET, req);
}

export async function ipcAgentRegistryUpsert(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.AGENT_REGISTRY_UPSERT, req);
}

export async function ipcAgentRegistryDelete(req: { agentId: string }) {
  return bridge().invoke(IPC_CHANNELS.AGENT_REGISTRY_DELETE, req);
}

export async function ipcAgentRegistryCreateBlank() {
  return bridge().invoke(IPC_CHANNELS.AGENT_REGISTRY_CREATE_BLANK);
}

export async function ipcAgentYamlExport(req: { agentId: string }) {
  return bridge().invoke(IPC_CHANNELS.AGENT_YAML_EXPORT, req);
}

export async function ipcAgentYamlImport(req: { agentId: string }) {
  return bridge().invoke(IPC_CHANNELS.AGENT_YAML_IMPORT, req);
}

export async function ipcRegexListGroups() {
  return bridge().invoke(IPC_CHANNELS.REGEX_LIST_GROUPS);
}

export async function ipcRegexCreateGroup(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.REGEX_CREATE_GROUP, req);
}

export async function ipcRegexUpdateGroup(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.REGEX_UPDATE_GROUP, req);
}

export async function ipcRegexDeleteGroup(req: { groupId: string }) {
  return bridge().invoke(IPC_CHANNELS.REGEX_DELETE_GROUP, req);
}

export async function ipcRegexListRules(req: { groupId: string }) {
  return bridge().invoke(IPC_CHANNELS.REGEX_LIST_RULES, req);
}

export async function ipcRegexGetRule(req: { groupId: string; ruleId: string }) {
  return bridge().invoke(IPC_CHANNELS.REGEX_GET_RULE, req);
}

export async function ipcRegexCreateRule(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.REGEX_CREATE_RULE, req);
}

export async function ipcRegexUpdateRule(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.REGEX_UPDATE_RULE, req);
}

export async function ipcRegexDeleteRule(req: { groupId: string; ruleId: string }) {
  return bridge().invoke(IPC_CHANNELS.REGEX_DELETE_RULE, req);
}

export async function ipcRegexListPicker() {
  return bridge().invoke(IPC_CHANNELS.REGEX_LIST_PICKER);
}

export async function ipcRegexSetCurrent(req: { groupId: string | null }) {
  return bridge().invoke(IPC_CHANNELS.REGEX_SET_CURRENT, req);
}

export async function ipcEventsGetConfig() {
  return bridge().invoke(IPC_CHANNELS.EVENTS_GET_CONFIG);
}

export async function ipcEventsSetConfig(req: { config: unknown }) {
  return bridge().invoke(IPC_CHANNELS.EVENTS_SET_CONFIG, req);
}

export async function ipcEventsClearConfig() {
  return bridge().invoke(IPC_CHANNELS.EVENTS_CLEAR_CONFIG);
}

export async function ipcEventsExportYaml() {
  return bridge().invoke(IPC_CHANNELS.EVENTS_EXPORT_YAML);
}

export async function ipcEventsImportYaml() {
  return bridge().invoke(IPC_CHANNELS.EVENTS_IMPORT_YAML);
}

export async function ipcCompactionConditionsGet() {
  return bridge().invoke(IPC_CHANNELS.COMPACTION_CONDITIONS_GET);
}

export async function ipcCompactionConditionsSet(req: unknown) {
  return bridge().invoke(IPC_CHANNELS.COMPACTION_CONDITIONS_SET, req);
}

export async function ipcBackupExport() {
  return bridge().invoke(IPC_CHANNELS.BACKUP_EXPORT);
}

export async function ipcBackupImport() {
  return bridge().invoke(IPC_CHANNELS.BACKUP_IMPORT);
}

export async function ipcShellMenuPopup(req: {
  menuId: "file" | "edit" | "view" | "window" | "help";
  x: number;
  y: number;
}) {
  return bridge().invoke<IpcResult<null>>(IPC_CHANNELS.SHELL_MENU_POPUP, req);
}

export async function ipcShellSetTitleBarTheme(theme: "light" | "dark") {
  return bridge().invoke(IPC_CHANNELS.SHELL_SET_TITLEBAR_THEME, theme);
}

export { vfsScope };
