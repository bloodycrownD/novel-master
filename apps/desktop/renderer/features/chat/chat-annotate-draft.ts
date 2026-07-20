/**
 * Desktop 入口：批注草稿 store 在 `@novel-master/core/chat`；
 * chip / ∪ 投影映射为 `MessageAttachmentDto`。
 */

import type { AnnotateDraft, MessageAttachment } from "@novel-master/core/chat";
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore as chipsFromAnnotateStoreCore,
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  removeChatAnnotateDraft,
  removeChatAnnotateDraftsByPath,
  resetChatAnnotateDraftStoreForTests,
  subscribeChatAnnotateDraft,
  unionComposerStatusWithAnnotate as unionComposerStatusWithAnnotateCore,
  updateChatAnnotateDraft,
} from "@novel-master/core/chat";
import type { MessageAttachmentDto } from "@shared/ipc-types";

export {
  addChatAnnotateDraft,
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  removeChatAnnotateDraft,
  removeChatAnnotateDraftsByPath,
  resetChatAnnotateDraftStoreForTests,
  subscribeChatAnnotateDraft,
  updateChatAnnotateDraft,
};
export type { AnnotateDraft };

function toAttachmentDto(a: MessageAttachment): MessageAttachmentDto {
  return {
    name: a.name,
    source: a.source,
    type: a.type,
    content: a.content,
    path: a.path,
    action: a.action,
  };
}

function toMessageAttachment(a: MessageAttachmentDto): MessageAttachment {
  return {
    name: a.name,
    source: a.source,
    type: a.type,
    content: a.content,
    path: a.path,
    action: a.action,
  };
}

/** 按 path 聚合一只 annotate 预览 chip（DTO）。 */
export function chipsFromAnnotateStore(
  sessionId: string | undefined,
): MessageAttachmentDto[] {
  return chipsFromAnnotateStoreCore(sessionId).map(toAttachmentDto);
}

/**
 * 投影结果 ∪ annotate store chips（按 path 一只；DTO）。
 */
export function unionComposerStatusWithAnnotate(
  projected: readonly MessageAttachmentDto[],
  sessionId: string | undefined,
): MessageAttachmentDto[] {
  return unionComposerStatusWithAnnotateCore(
    projected.map(toMessageAttachment),
    sessionId,
  ).map(toAttachmentDto);
}
