/**
 * Desktop Undo（undo_send / rewind）：从锚点附件反投影工作区批注草稿 + chip。
 * 状态条由 main 推空；本函数仅 ∪ annotate。
 */
import {
  parseAnnotateDraftsFromAttachments,
  type MessageAttachment,
} from "@shared/logic/chat";
import type { MessageAttachmentDto } from "@shared/ipc-types";
import {
  addChatAnnotateDraft,
  clearChatAnnotateDrafts,
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
 *
 * 按锚点消息角色区分清空语义（CR-5 闭合，产品 round 2 拍板）：
 * - 锚点为 assistant（rewind）：tail 里没有 user 消息，也就没有可恢复的批注，
 *   renderer 侧直接清空全部批注草稿（含未发送草稿），不做反投影。
 * - 锚点为 user（undo_send）：保留未发送草稿，从该 user 消息附件重新投影批注，
 *   未发送草稿与重新投影的草稿并存。
 *
 * 注意 main 进程的 annotate store 与 renderer 是各自独立的进程内 store，
 * main 侧仍按 Bug1 既定逻辑无条件清；本函数只负责 renderer 侧的语义对齐。
 *
 * @param anchorRole 锚点消息角色，决定「清空」还是「保留未发送 + 反投影」
 * @param existingStatusAttachments main suggest 已推的状态条（Undo 时通常为空 ops）
 */
export function applyUndoAnnotateRestore(
  sessionId: string,
  anchorRole: "user" | "assistant",
  attachments: readonly MessageAttachmentDto[] | null | undefined,
  existingStatusAttachments: readonly MessageAttachmentDto[] = [],
): MessageAttachmentDto[] {
  if (anchorRole === "assistant") {
    // 锚点为 assistant：清空 renderer 侧全部批注草稿，且没有附件可反投影。
    clearChatAnnotateDrafts(sessionId);
  } else {
    // 锚点为 user：保留未发送草稿，仅把附件里的 annotate 反投影进来（新 mint id），
    // 与未发送草稿并存——不清 store。
    if (attachments != null && attachments.length > 0) {
      const restored = parseAnnotateDraftsFromAttachments(
        attachments.map(toMessageAttachment),
      );
      for (const draft of restored) {
        addChatAnnotateDraft(sessionId, draft);
      }
    }
  }
  // Undo 时 main 已推空状态条；仅 ∪ annotate（D8）
  const opsHalf = existingStatusAttachments.filter(
    (a) => a.action !== "annotate",
  );
  return unionComposerStatusWithAnnotate(opsHalf, sessionId);
}
