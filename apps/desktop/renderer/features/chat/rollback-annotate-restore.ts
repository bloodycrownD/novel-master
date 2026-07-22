/**
 * Desktop Undo（undo_send）：从锚点附件反投影工作区批注草稿 + chip。
 * 不对齐手改旁路（D6 废止）；伪 `__message__:` path 由 parse 跳过。
 */
import {
  parseAnnotateDraftsFromAttachments,
  type MessageAttachment,
} from "@shared/logic/chat";
import type { MessageAttachmentDto } from "@shared/ipc-types";
import {
  addChatAnnotateDraft,
  unionComposerStatusWithAnnotate,
} from "./chat-annotate-draft";

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

/**
 * 解析附件 → annotate store（新 mint id）→ 返回 project∪annotate 状态条（ops 半边空）。
 */
export function applyUndoAnnotateRestore(
  sessionId: string,
  attachments: readonly MessageAttachmentDto[] | null | undefined,
): MessageAttachmentDto[] {
  if (attachments != null && attachments.length > 0) {
    const restored = parseAnnotateDraftsFromAttachments(
      attachments.map(toMessageAttachment),
    );
    for (const draft of restored) {
      addChatAnnotateDraft(sessionId, draft);
    }
  }
  return unionComposerStatusWithAnnotate([], sessionId);
}
