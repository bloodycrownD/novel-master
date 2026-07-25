/**
 * Desktop Undo（undo_send）：从锚点附件反投影工作区批注草稿 + chip。
 * 手改 ops 由 main `parseUserOpsLogFromAttachments` 写 main store 后经
 * COMPOSER_ATTACHMENTS_SUGGEST 推送；本函数仅 ∪ annotate。
 * **禁止** `unionComposerStatusWithAnnotate([], …)` wipe main 已推 user_ops chip。
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
 * 解析附件 → annotate store（新 mint id）→ 保留 existing ops 再 ∪ annotate。
 * @param existingStatusAttachments main suggest 已推的状态条（含 user_ops；可含旧 annotate）
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
  // 先保留 main 已推非 annotate ops，再 ∪ annotate（D8）
  const opsHalf = existingStatusAttachments.filter(
    (a) => a.action !== "annotate",
  );
  return unionComposerStatusWithAnnotate(opsHalf, sessionId);
}
