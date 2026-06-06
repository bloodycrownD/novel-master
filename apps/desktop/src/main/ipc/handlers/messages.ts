/**
 * Messages IPC handlers — list (display regex), append, edit, hide, delete, rollback.
 */
import { messageBodyText, textBlocks } from "@novel-master/core";
import type { ContentBlock } from "@novel-master/core";
import type {
  ChatMessageDto,
  ContentBlockDto,
  IpcResult,
  MessagesAppendRequest,
  MessagesDeleteRequest,
  MessagesEditRequest,
  MessagesForkRequest,
  MessagesHideRequest,
  MessagesListRequest,
  MessagesShowRequest,
  SessionDto,
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

function toContentBlockDto(block: ContentBlock): ContentBlockDto | null {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: block.toolUseId,
        content: block.content,
      };
    default:
      return null;
  }
}

function toDto(msg: {
  id: string;
  sessionId: string;
  role: string;
  hidden: boolean;
  seq: number;
  createdAtMs: number;
  content: { blocks?: readonly ContentBlock[] };
}): ChatMessageDto {
  const blocks = msg.content.blocks ?? [];
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    hidden: msg.hidden,
    seq: msg.seq,
    createdAtMs: msg.createdAtMs,
    bodyText: messageBodyText(msg as Parameters<typeof messageBodyText>[0]),
    contentBlocks: blocks
      .map(toContentBlockDto)
      .filter((b): b is ContentBlockDto => b != null),
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

export async function handleMessagesShow(
  req: MessagesShowRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.messages.show(req.messageId);
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

function toSessionDto(session: {
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

export async function handleMessagesFork(
  req: MessagesForkRequest,
): Promise<IpcResult<SessionDto>> {
  try {
    const rt = await getDesktopRuntime();
    const forked = await rt.messages.fork(req.sessionId, req.messageId);
    return { ok: true, data: toSessionDto(forked) };
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
