/**
 * Desktop Undo（undo_send / rewind）：从锚点附件反投影工作区批注草稿 + chip。
 * 手改 ops 由 main `clearUserOpsLog` 后推空；本函数仅 ∪ annotate。
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
 * 解析附件 → annotate store（新 mint id）→ ∪ annotate。
 * @param existingStatusAttachments main suggest 已推的状态条（Undo 时通常为空 ops）
 */
export function applyUndoAnnotateRestore(
  sessionId: string,
  attachments: readonly MessageAttachmentDto[] | null | undefined,
  existingStatusAttachments: readonly MessageAttachmentDto[] = [],
): MessageAttachmentDto[] {
  if (attachments != null && attachments.length > 0) {
    const restored = parseAnnotateDraftsFromAttachments(
      attachments.map(toMessageAttachment),
    );
    for (const draft of restored) {
      addChatAnnotateDraft(sessionId, draft);
    }
  }
  // Undo 时 main 已推空 ops；仅 ∪ annotate（D8）
  const opsHalf = existingStatusAttachments.filter(
    (a) => a.action !== "annotate",
  );
  return unionComposerStatusWithAnnotate(opsHalf, sessionId);
}
