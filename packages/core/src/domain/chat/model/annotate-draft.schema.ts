/**
 * 批注回合态草稿（→ `runAgentTurn` 入参）。
 * 允许进程内 store API（`chat-annotate-draft-store`）；禁止写入 `composer_draft_json`。
 *
 * @module domain/chat/model/annotate-draft.schema
 */

import { z } from "zod";

/** 正整数 optional（1-based 行列）。 */
const optionalPositiveInt = z.number().int().positive().optional();

/** 非负整数 optional（0-based UTF-16 offset）。 */
const optionalNonNegInt = z.number().int().nonnegative().optional();

/**
 * 单条未发送工作区（真 VFS path）批注草稿。
 *
 * 权威位置为半开区间 `startOffset` / `endOffset`（`[start, end)`，相对 VFS 全文）；
 * 行列由同一 offset 派生，供附件给模型与旧路径兼容。缺 offset 的旧草稿仍合法（A12）。
 */
export const annotateDraftSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    originalText: z.string(),
    userAnnotation: z.string(),
    /**
     * 宽松半开区间起点（UTF-16 code unit；相对 VFS 全文；语义 `[startOffset, endOffset)`）。
     * 新稿映射成功时必写；缺省兼容旧草稿。
     */
    startOffset: optionalNonNegInt,
    /**
     * 宽松半开区间终点（不含）；须严格大于 `startOffset`。
     */
    endOffset: optionalNonNegInt,
    /** 宽松窗口起始行（1-based，含）；由 offset 派生。 */
    startLine: optionalPositiveInt,
    /** 宽松窗口结束行（1-based，含）。 */
    endLine: optionalPositiveInt,
    /** 起始列（1-based，含）；缺省表示自行首。 */
    startCol: optionalPositiveInt,
    /** 结束列（1-based，含）；缺省表示至行尾。 */
    endCol: optionalPositiveInt,
  })
  .strict()
  .superRefine((val, ctx) => {
    const { startOffset, endOffset } = val;
    const hasStart = startOffset != null;
    const hasEnd = endOffset != null;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startOffset 与 endOffset 须成对出现",
        path: hasStart ? ["endOffset"] : ["startOffset"],
      });
      return;
    }
    if (hasStart && hasEnd && startOffset! >= endOffset!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "须满足 startOffset < endOffset（半开区间 [start, end)）",
        path: ["endOffset"],
      });
    }
  });

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
