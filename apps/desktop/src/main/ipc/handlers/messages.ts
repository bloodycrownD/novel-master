/**
 * Messages IPC handlers — list, append, edit, hide, delete, rollback.
 */
import {
  chatAnnotateDraftStore,
  readMessageMetadata,
  textBlocks,
  type ChatMessageData,
} from '@novel-master/core/chat';
import { messageBodyTextFromBlocks } from '@novel-master/core/prompt';
import { type ContentBlock } from '@novel-master/core/chat';
import { Result } from "@novel-master/core/errors";
import { assert } from "@novel-master/core/common";
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
import { toIpcResult } from "../ipc-result.js";
import { getDesktopRuntime } from '../../runtime/desktop-runtime-singleton.js';
import { refreshComposerStatusAfterFloorOrCompaction, refreshComposerStatusAfterSessionKkvCleared } from '../../services/notify-composer-status-after-kkv-clear.js';

function toDto(msg: ChatMessageData): ChatMessageDto {
  const metadata = readMessageMetadata(msg.raw);
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    hidden: msg.hidden,
    seq: msg.seq,
    createdAtMs: msg.createdAtMs,
    bodyText: messageBodyTextFromBlocks(msg.content.blocks),
    contentBlocks: (msg.content.blocks ?? []).map((block): ContentBlockDto | null => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'thinking':
          return { type: 'thinking', text: block.text };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
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
    }).filter((b): b is ContentBlockDto => b != null),
    ...(metadata != null ? { metadata } : {}),
    ...(msg.attachments != null && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
  };
}

export function handleMessagesList(req: MessagesListRequest): Promise<IpcResult<ChatMessageDto[]>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const messagesRead = await rt.messages.listBySession(req.sessionId);
    if (messagesRead.kind === "failed") return Result.err(messagesRead.error);
    // IPC handler 未注入 hooks（中断分支不可达）；命中即不变量破坏，断言收口。
    assert(messagesRead.kind === "completed", "handleMessagesList 未注入 hooks，listBySession 不应产生中断");
    return Result.ok(messagesRead.value.map(toDto));
  });
}

export function handleMessagesAppend(req: MessagesAppendRequest): Promise<IpcResult<ChatMessageDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const msg = await rt.messages.append(req.sessionId, req.role, textBlocks(req.text));
    return msg.map(toDto);
  });
}

export function handleMessagesEdit(req: MessagesEditRequest): Promise<IpcResult<ChatMessageDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const existing = await rt.messages.get(req.messageId);
    if (!existing.ok) return Result.err(existing.error);
    // 在首个 text 块处合并编辑文本；thinking / tool_use 顺序原样保留（首个之后的 text 块丢弃）。
    const merged: ContentBlock[] = [];
    let textReplaced = false;
    for (const block of existing.value.content.blocks ?? []) {
      if (block.type === 'text') {
        if (!textReplaced) {
          merged.push({ type: 'text', text: req.text });
          textReplaced = true;
        }
      } else {
        merged.push(block);
      }
    }
    return (await rt.messages.updateContent(req.messageId, { blocks: merged })).map(toDto);
  });
}

export function handleMessagesHide(req: MessagesHideRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const msg = await rt.messages.get(req.messageId);
    if (!msg.ok) return Result.err(msg.error);
    const hidden = await rt.messages.hideRange(msg.value.sessionId, msg.value.seq, msg.value.seq);
    return hidden.map(() => undefined);
  });
}

export function handleMessagesShow(req: MessagesShowRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const msg = await rt.messages.get(req.messageId);
    if (!msg.ok) return Result.err(msg.error);
    const shown = await rt.messages.showRange(msg.value.sessionId, msg.value.seq, msg.value.seq);
    return shown.map(() => undefined);
  });
}

export function handleMessagesHideRange(req: MessagesHideRangeRequest): Promise<IpcResult<{ count: number }>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const count = await rt.messages.hideRange(req.sessionId, req.fromSeq, req.toSeq);
    return count.map((n) => ({ count: n }));
  });
}

export function handleMessagesShowRange(req: MessagesShowRangeRequest): Promise<IpcResult<{ count: number }>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const count = await rt.messages.showRange(req.sessionId, req.fromSeq, req.toSeq);
    return count.map((n) => ({ count: n }));
  });
}

export function handleMessagesTruncateAfter(req: MessagesTruncateAfterRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    await rt.messageTranscriptEffects.truncateMessagesAfter(req.projectId, req.sessionId, req.afterSeq);
    return Result.ok(undefined);
  });
}

export function handleMessagesDelete(req: MessagesDeleteRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return rt.messages.delete(req.messageId);
  });
}

export function handleMessagesSetFloor(req: MessagesSetFloorPayload): Promise<IpcResult<MessagesSetFloorResult>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    // clear rule_snapshot + file_cache 由 Core setMessageFloorAtMessage 完成
    const result = await rt.messageTranscriptEffects.setMessageFloorAtMessage(req.projectId, req.sessionId, req.messageId);
    // 置位：project∪annotate；禁止终态强制 []
    if (!result.ok) return Result.err(result.error);
    await refreshComposerStatusAfterFloorOrCompaction({ projectId: req.projectId, sessionId: req.sessionId });
    return Result.ok(result.value);
  });
}

export function handleMessagesFork(req: MessagesForkRequest): Promise<IpcResult<SessionDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const forked = await rt.messages.fork(req.sessionId, req.messageId);
    return forked.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      title: session.title,
      parentSessionId: session.parentSessionId,
      createdAtMs: session.createdAtMs,
      updatedAtMs: session.updatedAtMs,
    }));
  });
}

export function handleMessagesRollback(req: SessionFsRollbackRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;

    // 实现侧只读 options?.field（message-rollback.service.ts:158-226），空对象与 undefined 等价，恒传对象免去空判。
    const rollbackOptions = {
      ...(req.skipVfsReconcile ? { skipVfsReconcile: true as const } : {}),
      ...(req.revisionHeadBackfill ? { revisionHeadBackfill: true as const } : {}),
    };
    const rollback = await rt.sessionFs.rollbackFilesToMessage(req.sessionId, req.projectId, req.messageId, rollbackOptions);
    if (!rollback.ok) return Result.err(rollback.error);

    // D8：undo_send / rewind 均推空状态条；main 侧 annotate store 一并清。
    // main 进程拿不到 mode（mode 由 renderer 算）——renderer 侧的清空 / 反投影
    // 由 renderer 的 applyUndoAnnotateRestore 按锚点角色区分处理（CR-5）。
    chatAnnotateDraftStore.clear(req.sessionId);
    await refreshComposerStatusAfterSessionKkvCleared({ projectId: req.projectId, sessionId: req.sessionId });
    return Result.ok(undefined);
  });
}
