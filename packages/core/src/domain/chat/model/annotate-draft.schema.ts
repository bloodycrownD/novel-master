/**
 * 批注回合态草稿（→ `runAgentTurn` 入参）。
 * 允许进程内 store API（`chat-annotate-draft-store`）；禁止写入 `composer_draft_json`。
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
 * 发送管线批注草稿（仅文件形）。
 * 历史消息批注伪 path 仍由 `isMessageAnnotatePath` 识别并跳过 Undo。
 */
export type SendAnnotateDraft = AnnotateDraft;

/** 历史消息批注伪 path 识别子串（含 `/__message__:`；防御保留）。 */
export const MESSAGE_ANNOTATE_PATH_MARKER = "__message__:";

/** `path.includes('__message__:')` → 历史消息批注伪 path（Undo 恢复须跳过）。 */
export function isMessageAnnotatePath(
  path: string | null | undefined,
): boolean {
  return typeof path === "string" && path.includes(MESSAGE_ANNOTATE_PATH_MARKER);
}
