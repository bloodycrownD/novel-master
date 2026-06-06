/**
 * Messages IPC handlers — list (display regex), append, edit, hide, delete, rollback.
 */
import { messageBodyText, textBlocks } from "@novel-master/core";
import type {
  ChatMessageDto,
  IpcResult,
  MessagesAppendRequest,
  MessagesDeleteRequest,
  MessagesEditRequest,
  MessagesHideRequest,
  MessagesListRequest,
  SessionFsRollbackRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { loadSessionMessagesForDisplay } from "../../services/regex-apply-channel.service.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

function toDto(msg: {
  id: string;
  sessionId: string;
  role: string;
  hidden: boolean;
  seq: number;
  createdAtMs: number;
}): ChatMessageDto {
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    hidden: msg.hidden,
    seq: msg.seq,
    createdAtMs: msg.createdAtMs,
    bodyText: messageBodyText(msg as Parameters<typeof messageBodyText>[0]),
  };
}

export async function handleMessagesList(
  req: MessagesListRequest,
): Promise<IpcResult<ChatMessageDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const messages = await loadSessionMessagesForDisplay(rt, req.sessionId);
    return { ok: true, data: messages.map(toDto) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleMessagesAppend(
  req: MessagesAppendRequest,
): Promise<IpcResult<ChatMessageDto>> {
  try {
    const rt = await getDesktopRuntime();
    const msg = await rt.messages.append(
      req.sessionId,
      req.role,
      textBlocks(req.text),
    );
    return { ok: true, data: toDto(msg) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleMessagesEdit(
  req: MessagesEditRequest,
): Promise<IpcResult<ChatMessageDto>> {
  try {
    const rt = await getDesktopRuntime();
    const msg = await rt.messages.updateContent(
      req.messageId,
      textBlocks(req.text),
    );
    return { ok: true, data: toDto(msg) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleMessagesHide(
  req: MessagesHideRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.messages.hide(req.messageId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleMessagesDelete(
  req: MessagesDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.messages.delete(req.messageId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleMessagesRollback(
  req: SessionFsRollbackRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.sessionFs.rollbackToMessage(
      req.sessionId,
      req.projectId,
      req.messageId,
    );
    rt.macroCache.clear(req.projectId, req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
