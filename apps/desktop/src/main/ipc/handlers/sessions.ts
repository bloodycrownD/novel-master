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
  SessionGetAgentBindingRequest,
  SessionGetComposerDraftRequest,
  SessionListByProjectRequest,
  SessionProjectComposerStatusRequest,
  SessionPullTemplateRequest,
  SessionRenameRequest,
  SessionSetAgentBindingRequest,
  SessionSetComposerDraftRequest,
  SessionSetModelOverrideRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";
import { projectComposerStatusForSession } from "../../services/project-composer-status.service.js";

function toDto(session: {
  id: string;
  projectId: string;
  title: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}): SessionDto {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
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
    return { ok: true, data: sessions.map(toDto) };
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
    return { ok: true, data: toDto(session) };
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
    return { ok: true, data: toDto(session) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsDelete(
  req: SessionDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.sessions.delete(req.id);
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
    await rt.sessions.pullTemplate(req.sessionId);
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
    return { ok: true, data: draftJson };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSessionsSetComposerDraft(
  req: SessionSetComposerDraftRequest,
): Promise<IpcResult<boolean>> {
  try {
    const rt = await getDesktopRuntime();
    const ok = await rt.sessions.setComposerDraftJson(
      req.sessionId,
      req.draftJson,
    );
    return { ok: true, data: ok };
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

/** 读取会话级智能体绑定（透传 core sessions service）。 */
export async function handleSessionsGetAgentBinding(
  req: SessionGetAgentBindingRequest,
): Promise<IpcResult<SessionAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    const config = await rt.sessions.getSessionAgentConfig(req.sessionId);
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 写会话级智能体绑定。`agentId: null` 解绑回 follow；具体 id 写 bind。
 * 返回最新 config，UI 拿到后可直接刷新本地状态（无需重新 GET）。
 */
export async function handleSessionsSetAgentBinding(
  req: SessionSetAgentBindingRequest,
): Promise<IpcResult<SessionAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    const patch =
      req.agentId == null
        ? { mode: 'follow' as const }
        : { mode: 'bind' as const, agentId: req.agentId };
    const config = await rt.sessions.updateSessionAgentConfig(
      req.sessionId,
      patch,
    );
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 写会话级模型覆盖。`modelId: null` 清除覆盖；mode 与 agentId 保持现状。
 * 返回最新 config，UI 拿到后可直接刷新本地状态（无需重新 GET）。
 */
export async function handleSessionsSetModelOverride(
  req: SessionSetModelOverrideRequest,
): Promise<IpcResult<SessionAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    const config = await rt.sessions.updateSessionAgentConfig(
      req.sessionId,
      { modelId: req.modelId },
    );
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
