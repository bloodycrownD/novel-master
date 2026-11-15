/**
 * Session CRUD IPC handlers.
 */
import type {
  IpcResult,
  MessageAttachmentDto,
  SessionAgentConfigDto,
  SessionCreateRequest,
  SessionDeleteRequest,
  SessionDto,
  SessionGetComposerDraftRequest,
  SessionListByProjectRequest,
  SessionProjectComposerStatusRequest,
  SessionPullTemplateRequest,
  SessionPushTemplateRequest,
  SessionRenameRequest,
  SessionSetAgentBindingRequest,
  SessionSetComposerDraftRequest,
  SessionSetModelOverrideRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";
import { ipcErr } from "../ipc-result.js";
import { notifyWorkspaceMutatedToRenderer } from "../forward-workspace-mutated.js";
import { projectComposerStatusForSession } from "../../services/project-composer-status.service.js";

function toDto(session: {
  id: string;
  projectId: string;
  title: string | null;
  parentSessionId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}): SessionDto {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    parentSessionId: session.parentSessionId,
    createdAtMs: session.createdAtMs,
    updatedAtMs: session.updatedAtMs,
  };
}

export async function handleSessionsListByProject(
  req: SessionListByProjectRequest,
): Promise<IpcResult<SessionDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const sessions = await rt.sessions.listByProject(req.projectId);
    if (!sessions.ok) return ipcErr(formatIpcError(sessions.error));
    return { ok: true, data: sessions.value.map(toDto) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsCreate(
  req: SessionCreateRequest,
): Promise<IpcResult<SessionDto>> {
  try {
    const rt = await getDesktopRuntime();
    const session = await rt.sessions.create(req.projectId, req.title);
    if (!session.ok) return ipcErr(formatIpcError(session.error));
    return { ok: true, data: toDto(session.value) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsRename(
  req: SessionRenameRequest,
): Promise<IpcResult<SessionDto>> {
  try {
    const rt = await getDesktopRuntime();
    const session = await rt.sessions.rename(req.id, req.title);
    if (!session.ok) return ipcErr(formatIpcError(session.error));
    return { ok: true, data: toDto(session.value) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsDelete(
  req: SessionDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const deleted = await rt.sessions.delete(req.id);
    if (!deleted.ok) return ipcErr(formatIpcError(deleted.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsPullTemplate(
  req: SessionPullTemplateRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const pulled = await rt.sessions.pullTemplate(req.sessionId);
    if (!pulled.ok) return ipcErr(formatIpcError(pulled.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 推送到项目工作区：用当前聊天工作区（文件 + workplace 规则）整树覆盖
 * project 模板（该项目所有会话的模板母本）。
 *
 * 成功后 notify 项目工作区面板刷新——注意 IPC 面板语义里 `'session'`
 * 面板就是项目工作区（core project 域），`'chat'` 才是会话域；推送覆盖
 * 的是前者，故 payload 用 `{workspaceScope: 'session', projectId}`。
 * projectId 经会话查询取得（不改 Request 形状）；失败不 notify。
 */
export async function handleSessionsPushTemplate(
  req: SessionPushTemplateRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const pushed = await rt.sessions.pushTemplate(req.sessionId);
    if (!pushed.ok) return ipcErr(formatIpcError(pushed.error));
    const session = await rt.sessions.get(req.sessionId);
    if (!session.ok) return ipcErr(formatIpcError(session.error));
    notifyWorkspaceMutatedToRenderer({
      workspaceScope: "session",
      projectId: session.value.projectId,
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsGetComposerDraft(
  req: SessionGetComposerDraftRequest,
): Promise<IpcResult<string | null>> {
  try {
    const rt = await getDesktopRuntime();
    const draftJson = await rt.sessions.getComposerDraftJson(req.sessionId);
    if (!draftJson.ok) return ipcErr(formatIpcError(draftJson.error));
    return { ok: true, data: draftJson.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsSetComposerDraft(
  req: SessionSetComposerDraftRequest,
): Promise<IpcResult<boolean>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await rt.sessions.setComposerDraftJson(
      req.sessionId,
      req.draftJson,
    );
    if (!saved.ok) return ipcErr(formatIpcError(saved.error));
    return { ok: true, data: saved.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsProjectComposerStatus(
  req: SessionProjectComposerStatusRequest,
): Promise<IpcResult<MessageAttachmentDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const attachments = await projectComposerStatusForSession(
      rt,
      req.sessionId,
    );
    return { ok: true, data: attachments };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 写会话级智能体绑定。
 *
 * `agentId: null` 表示将该会话的 agentId 同步为 workspace 当前 agent（作为该会话
 * 的新默认值）；会话始终持有 agentId，这不是解绑/回退，而是「同步到当前默认」。
 * 具体 id 直接写入。返回最新 config，UI 拿到后可直接刷新本地状态（无需重新 GET）。
 *
 * core 的 `updateSessionAgentConfig` 为 partial overlay：只传 `{ agentId }` 时
 * modelId 会被保留，因此切 agent 不会清掉会话上已有的 modelId 覆盖。
 */
export async function handleSessionsSetAgentBinding(
  req: SessionSetAgentBindingRequest,
): Promise<IpcResult<SessionAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    // null 表示同步到 workspace 当前 agent（state 优先，缺失回落 registry 首项）。
    // 会话始终持有 agentId，不存在「解绑」语义。
    let agentId = req.agentId;
    if (agentId == null) {
      const fromState = await rt.state.getCurrentAgentId();
      if (!fromState.ok) return ipcErr(formatIpcError(fromState.error));
      agentId =
        fromState.value && fromState.value !== ""
          ? fromState.value
          : (await rt.agentRegistry.listAgentIds())[0];
      if (agentId == null || agentId === "") {
        return {
          ok: false,
          error: formatIpcError(
            new Error(
              "同步 workspace agent 失败：workspace 未配置 Agent，且 registry 为空",
            ),
          ),
        };
      }
    }
    // partial overlay：只传 agentId，core 会保留 modelId（切 agent 不清模型覆盖）。
    const config = await rt.sessions.updateSessionAgentConfig(req.sessionId, {
      agentId,
    });
    if (!config.ok) return ipcErr(formatIpcError(config.error));
    return { ok: true, data: config.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 写会话级模型覆盖。
 *
 * `modelId: null` 清除覆盖；agentId 保持现状不动。返回最新 config，UI 拿到后
 * 可直接刷新本地状态（无需重新 GET）。
 *
 * core 的 `updateSessionAgentConfig` 为 partial overlay：只传 `{ modelId }` 时
 * agentId 会被保留，`modelId: null` 表示显式清除。因此这里不再需要先读当前
 * config 再回写（去 read-modify-write），直接把 modelId 透传给 core 即可。
 */
export async function handleSessionsSetModelOverride(
  req: SessionSetModelOverrideRequest,
): Promise<IpcResult<SessionAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    // partial overlay：core 接受 modelId: null 表示清除，agentId 自动保留。
    const config = await rt.sessions.updateSessionAgentConfig(req.sessionId, {
      modelId: req.modelId,
    });
    if (!config.ok) return ipcErr(formatIpcError(config.error));
    return { ok: true, data: config.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
