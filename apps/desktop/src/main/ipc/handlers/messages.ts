/**
 * Messages IPC handlers — list (display regex), append, edit, hide, delete, rollback.
 */
import {
  readMessageMetadata,
  textBlocks,
  type ChatMessage,
  type MessageContent,
} from "@novel-master/core/chat";

import { messageBodyText } from "@novel-master/core/prompt";
import { type ContentBlock } from "@novel-master/core/chat";
import type {
  ChatMessageDto,
  ContentBlockDto,
  IpcResult,
  MessagesAppendRequest,
  MessagesAppendToolTurnBridgeRequest,
  MessagesDeleteRequest,
  MessagesEditRequest,
  MessagesForkRequest,
  MessagesHideRequest,
  MessagesHideRangeRequest,
  MessagesListRequest,
  MessagesShowRequest,
  MessagesSetFloorPayload,
  MessagesSetFloorResult,
  MessagesShowRangeRequest,
  MessagesTruncateAfterRequest,
  SessionDto,
  SessionFsRollbackRequest,
} from "../../../../shared/ipc-types.js";
import { formatIpcError } from "../format-ipc-error.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { loadSessionMessagesForDisplay } from "../../services/regex-apply-channel.service.js";

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
        ...(block.ok !== undefined ? { ok: block.ok } : {}),
        ...(block.summary !== undefined ? { summary: block.summary } : {}),
      };
    default:
      return null;
  }
}

function toDto(msg: ChatMessage): ChatMessageDto {
  const blocks = msg.content.blocks ?? [];
  const metadata = readMessageMetadata(msg.raw);
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    hidden: msg.hidden,
    seq: msg.seq,
    createdAtMs: msg.createdAtMs,
    bodyText: messageBodyText(msg),
    contentBlocks: blocks
      .map(toContentBlockDto)
      .filter((b): b is ContentBlockDto => b != null),
    ...(metadata != null ? { metadata } : {}),
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
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesAppendToolTurnBridge(
  req: MessagesAppendToolTurnBridgeRequest,
): Promise<IpcResult<ChatMessageDto>> {
  try {
    const rt = await getDesktopRuntime();
    const msg = await rt.appendToolTurnBridge(req.sessionId);
    return { ok: true, data: toDto(msg) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
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
    return { ok: false, error: formatIpcError(err) };
  }
}

/** Merges edited text at first text-block slot; preserves thinking / tool_use order. */
function applyTextEditToMessageContent(
  content: MessageContent,
  newText: string,
): MessageContent {
  const blocks = content.blocks ?? [];
  const result: ContentBlock[] = [];
  let textReplaced = false;

  for (const block of blocks) {
    if (block.type === "text") {
      if (!textReplaced) {
        result.push({ type: "text", text: newText });
        textReplaced = true;
      }
    } else {
      result.push(block);
    }
  }

  return { blocks: result };
}

export async function handleMessagesEdit(
  req: MessagesEditRequest,
): Promise<IpcResult<ChatMessageDto>> {
  try {
    const rt = await getDesktopRuntime();
    const existing = await rt.messages.get(req.messageId);
    const merged = applyTextEditToMessageContent(existing.content, req.text);
    const msg = await rt.messages.updateContent(req.messageId, merged);
    return { ok: true, data: toDto(msg) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesHide(
  req: MessagesHideRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const msg = await rt.messages.get(req.messageId);
    const session = await rt.sessions.get(msg.sessionId);
    await rt.messageTranscriptEffects.hideMessagesInRange(
      session.projectId,
      msg.sessionId,
      msg.seq,
      msg.seq,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesShow(
  req: MessagesShowRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const msg = await rt.messages.get(req.messageId);
    const session = await rt.sessions.get(msg.sessionId);
    await rt.messageTranscriptEffects.showMessagesInRange(
      session.projectId,
      msg.sessionId,
      msg.seq,
      msg.seq,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesHideRange(
  req: MessagesHideRangeRequest,
): Promise<IpcResult<{ count: number }>> {
  try {
    const rt = await getDesktopRuntime();
    const session = await rt.sessions.get(req.sessionId);
    const count = await rt.messageTranscriptEffects.hideMessagesInRange(
      session.projectId,
      req.sessionId,
      req.fromSeq,
      req.toSeq,
    );
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesShowRange(
  req: MessagesShowRangeRequest,
): Promise<IpcResult<{ count: number }>> {
  try {
    const rt = await getDesktopRuntime();
    const session = await rt.sessions.get(req.sessionId);
    const count = await rt.messageTranscriptEffects.showMessagesInRange(
      session.projectId,
      req.sessionId,
      req.fromSeq,
      req.toSeq,
    );
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesTruncateAfter(
  req: MessagesTruncateAfterRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.messageTranscriptEffects.truncateMessagesAfter(
      req.projectId,
      req.sessionId,
      req.afterSeq,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
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
    return { ok: false, error: formatIpcError(err) };
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

export async function handleMessagesSetFloor(
  req: MessagesSetFloorPayload,
): Promise<IpcResult<MessagesSetFloorResult>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await rt.messageTranscriptEffects.setMessageFloorAtMessage(
      req.projectId,
      req.sessionId,
      req.messageId,
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesFork(
  req: MessagesForkRequest,
): Promise<IpcResult<SessionDto>> {
  try {
    const rt = await getDesktopRuntime();
    const forked = await rt.messages.fork(req.sessionId, req.messageId);
    return { ok: true, data: toSessionDto(forked) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleMessagesRollback(
  req: SessionFsRollbackRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const rollbackOptions =
      req.skipVfsReconcile || req.revisionHeadBackfill
        ? {
            ...(req.skipVfsReconcile ? { skipVfsReconcile: true as const } : {}),
            ...(req.revisionHeadBackfill
              ? { revisionHeadBackfill: true as const }
              : {}),
          }
        : undefined;
    await rt.sessionFs.rollbackToMessage(
      req.sessionId,
      req.projectId,
      req.messageId,
      rollbackOptions,
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
