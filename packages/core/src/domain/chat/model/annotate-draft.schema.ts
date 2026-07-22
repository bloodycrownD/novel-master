/**
 * 批注回合态草稿（→ `runAgentTurn` 入参）。
 * 允许进程内 store API（`chat-annotate-draft-store` /
 * `chat-message-annotate-draft-store`）；禁止写入 `composer_draft_json`。
 *
 * @module domain/chat/model/annotate-draft.schema
 */

import { z } from "zod";

/** 单条未发送工作区（真 VFS path）批注草稿。 */
export const annotateDraftSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    originalText: z.string(),
    userAnnotation: z.string(),
  })
  .strict();

export type AnnotateDraft = z.infer<typeof annotateDraftSchema>;

/** 批注草稿数组。 */
export const annotateDraftsSchema = z.array(annotateDraftSchema);

export type AnnotateDrafts = z.infer<typeof annotateDraftsSchema>;

/**
 * 消息正文批注草稿（无 VFS path；落库时由 builder 生成伪 path）。
 * 禁止写入文件批注 store / chip 投影。
 */
export const messageAnnotateDraftSchema = z
  .object({
    id: z.string().min(1),
    messageId: z.string().min(1),
    originalText: z.string(),
    userAnnotation: z.string(),
  })
  .strict();

export type MessageAnnotateDraft = z.infer<typeof messageAnnotateDraftSchema>;

/**
 * 发送管线批注联合：文件形 `AnnotateDraft` | 消息形 `MessageAnnotateDraft`。
 * Desktop 可继续只传文件形；联合向后兼容。
 */
export type SendAnnotateDraft = AnnotateDraft | MessageAnnotateDraft;

/** 消息批注伪 path 识别子串（含 `/__message__:`）。 */
export const MESSAGE_ANNOTATE_PATH_MARKER = "__message__:";

/** `path.includes('__message__:')` → 消息批注伪 path（Undo 恢复须跳过）。 */
export function isMessageAnnotatePath(
  path: string | null | undefined,
): boolean {
  return typeof path === "string" && path.includes(MESSAGE_ANNOTATE_PATH_MARKER);
}

/** 构造消息批注落库伪 path：`__message__:<messageId>:<draftId>`。 */
export function buildMessageAnnotatePseudoPath(
  messageId: string,
  draftId: string,
): string {
  return `${MESSAGE_ANNOTATE_PATH_MARKER}${messageId}:${draftId}`;
}

/** 判别是否为消息形发送草稿（有 `messageId` → 消息形）。 */
export function isMessageAnnotateDraft(
  draft: SendAnnotateDraft,
): draft is MessageAnnotateDraft {
  return (
    "messageId" in draft &&
    typeof (draft as MessageAnnotateDraft).messageId === "string" &&
    (draft as MessageAnnotateDraft).messageId.length > 0
  );
}
