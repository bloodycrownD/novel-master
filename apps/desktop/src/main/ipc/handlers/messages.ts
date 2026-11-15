/**
 * Messages IPC handlers — list, append, edit, hide, delete, rollback.
 */
import {
  chatAnnotateDraftStore,
  readMessageMetadata,
  textBlocks,
  type ChatMessageData,
  type MessageContent,
} from '@novel-master/core/chat';

import {
  messageBodyTextFromBlocks,
} from '@novel-master/core/prompt';
import { type ContentBlock } from '@novel-master/core/chat';
import type {
  ChatMessageDto,
  ContentBlockDto,
  IpcResult,
  MessagesAppendRequest,
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
} from '../../../../shared/ipc-types.js';
import { formatIpcError } from '../format-ipc-error.js';
import { getDesktopRuntime } from '../../runtime/desktop-runtime-singleton.js';
import { notifyComposerStatusAfterFloorOrCompaction, notifyComposerStatusAfterSessionKkvCleared } from '../../services/notify-composer-status-after-kkv-clear.js';

function toContentBlockDto(block: ContentBlock): ContentBlockDto | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'thinking':
      return { type: 'thinking', text: block.text };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        toolUseId: block.toolUseId,
        content: block.content,
        ...(block.ok !== undefined ? { ok: block.ok } : {}),
        ...(block.summary !== undefined ? { summary: block.summary } : {}),
        ...(block.meta != null ? { meta: block.meta } : {}),
      };
    default:
      return null;
  }
}

function toDto(msg: ChatMessageData): ChatMessageDto {
  const blocks = msg.content.blocks ?? [];
  const metadata = readMessageMetadata(msg.raw);
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    hidden: msg.hidden,
    seq: msg.seq,
    createdAtMs: msg.createdAtMs,
    bodyText: messageBodyTextFromBlocks(msg.content.blocks),
    contentBlocks: blocks
      .map(toContentBlockDto)
      .filter((b): b is ContentBlockDto => b != null),
    ...(metadata != null ? { metadata } : {}),
    ...(msg.attachments != null && msg.attachments.length > 0
      ? { attachments: msg.attachments }
      : {}),
  };
}

export async function handleMessagesList(
  req: MessagesListRequest,
): Promise<IpcResult<ChatMessageDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const messages = await rt.messages.listBySession(req.sessionId);
    return { ok: true, data: messages.map(toDto) };
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
    if (!msg.ok) throw msg.error;
    return { ok: true, data: toDto(msg.value) };
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
    if (block.type === 'text') {
      if (!textReplaced) {
        result.push({ type: 'text', text: newText });
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
    if (!existing.ok) throw existing.error;
    const merged = applyTextEditToMessageContent(existing.value.content, req.text);
    const msg = await rt.messages.updateContent(req.messageId, merged);
    if (!msg.ok) throw msg.error;
    return { ok: true, data: toDto(msg.value) };
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
    if (!msg.ok) throw msg.error;
    const session = await rt.sessions.get(msg.value.sessionId);
    if (!session.ok) throw session.error;
    const hidden = await rt.messageTranscriptEffects.hideMessagesInRange(
      session.value.projectId,
      msg.value.sessionId,
      msg.value.seq,
      msg.value.seq,
    );
    if (!hidden.ok) throw hidden.error;
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
    if (!msg.ok) throw msg.error;
    const session = await rt.sessions.get(msg.value.sessionId);
    if (!session.ok) throw session.error;
    const shown = await rt.messageTranscriptEffects.showMessagesInRange(
      session.value.projectId,
      msg.value.sessionId,
      msg.value.seq,
      msg.value.seq,
    );
    if (!shown.ok) throw shown.error;
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
    if (!session.ok) throw session.error;
    const count = await rt.messageTranscriptEffects.hideMessagesInRange(
      session.value.projectId,
      req.sessionId,
      req.fromSeq,
      req.toSeq,
    );
    if (!count.ok) throw count.error;
    return { ok: true, data: { count: count.value } };
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
    if (!session.ok) throw session.error;
    const count = await rt.messageTranscriptEffects.showMessagesInRange(
      session.value.projectId,
      req.sessionId,
      req.fromSeq,
      req.toSeq,
    );
    if (!count.ok) throw count.error;
    return { ok: true, data: { count: count.value } };
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
    const deleted = await rt.messages.delete(req.messageId);
    if (!deleted.ok) throw deleted.error;
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

function toSessionDto(session: {
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

export async function handleMessagesSetFloor(
  req: MessagesSetFloorPayload,
): Promise<IpcResult<MessagesSetFloorResult>> {
  try {
    const rt = await getDesktopRuntime();
    // clear rule_snapshot + file_cache 由 Core setMessageFloorAtMessage 完成
    const result = await rt.messageTranscriptEffects.setMessageFloorAtMessage(
      req.projectId,
      req.sessionId,
      req.messageId,
    );
    // 置位：project∪annotate；禁止终态强制 []
    if (!result.ok) throw result.error;
    await notifyComposerStatusAfterFloorOrCompaction(rt, req.sessionId);
    return { ok: true, data: result.value };
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
    if (!forked.ok) throw forked.error;
    return { ok: true, data: toSessionDto(forked.value) };
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
            ...(req.skipVfsReconcile
              ? { skipVfsReconcile: true as const }
              : {}),
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

    // D8：undo_send / rewind 均推空状态条；main 侧 annotate store 一并清。
    // main 进程拿不到 mode（mode 由 renderer 算）——renderer 侧的清空 / 反投影
    // 由 renderer 的 applyUndoAnnotateRestore 按锚点角色区分处理（CR-5）。
    chatAnnotateDraftStore.clear(req.sessionId);
    await notifyComposerStatusAfterSessionKkvCleared(rt, req.sessionId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
