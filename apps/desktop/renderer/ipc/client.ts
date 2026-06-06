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
  type MessagesHideRequest,
  type MessagesListRequest,
  type ModelListPickerResponse,
  type ModelSetCurrentRequest,
  type ProjectCreateRequest,
  type ProjectDeleteRequest,
  type ProjectDto,
  type ProjectPullTemplateRequest,
  type ProjectRenameRequest,
  type PromptAgentMetaResponse,
  type PromptPreviewSegmentDto,
  type PromptScopeRequest,
  type ScopeSetProjectRequest,
  type ScopeSetSessionRequest,
  type ScopeSnapshotDto,
  type SessionCreateRequest,
  type SessionDeleteRequest,
  type SessionDto,
  type SessionFsExecuteRequest,
  type SessionFsListBatchesRequest,
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
    throw new Error("novelMasterDesktop preload bridge is unavailable");
  }
  return window.novelMasterDesktop;
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

export async function ipcSessionFsExecute(
  req: SessionFsExecuteRequest,
): Promise<IpcResult<{ batchId: string }>> {
  return bridge().invoke(IPC_CHANNELS.SESSION_FS_EXECUTE, req);
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

export async function ipcMessagesDelete(
  req: MessagesDeleteRequest,
): Promise<IpcResult<void>> {
  return bridge().invoke(IPC_CHANNELS.MESSAGES_DELETE, req);
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
): Promise<IpcResult<string>> {
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

export { vfsScope };
