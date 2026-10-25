/**
 * Desktop 入口：批注草稿 store 在 `@shared/logic/chat`；
 * chip / ∪ 投影映射为 `MessageAttachmentDto`。
 */

import type { AnnotateDraft, MessageAttachment } from "@shared/logic/chat";
import { chatAnnotateDraftStore } from "@shared/logic/chat";
import type { MessageAttachmentDto } from "@shared/ipc-types";

export { chatAnnotateDraftStore };
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

/** 投影结果 ∪ annotate store chips（按 path 一只；DTO）。 */
export function unionComposerStatusWithAnnotate(projected: readonly MessageAttachmentDto[], sessionId: string | undefined): MessageAttachmentDto[] {
  return chatAnnotateDraftStore.union(projected.map(toMessageAttachment), sessionId).map(toAttachmentDto);
}
