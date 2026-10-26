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
 * **预览投影权威**（新稿）：半开 `renderStart` / `renderEnd`（`[start, end)`），
 * 相对 MD 渲染后、Recogito 所挂容器的可见正文（UTF-16，与 Recogito `target.selector` 一致）。
 *
 * `startOffset` / `endOffset` / 行列：旧 VFS soft offset 路径，可读可写以兼容存量；
 * **不再作为预览投影权威**（A12：仅有旧 offset 的草稿可不投影高亮，chip/详情/发送仍可用）。
 *
 * nm-style: keep-public — AnnotateDraft 类型源与 schema 单测入口。
 */
export const annotateDraftSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  /** Recogito quote（划词原文）。 */
  originalText: z.string(),
  userAnnotation: z.string(),
  /**
   * MD 渲染正文 / Recogito 容器坐标系半开起点（UTF-16 code unit；`[renderStart, renderEnd)`）。
   * 新稿必写；缺省兼容仅有旧 VFS offset 的存量草稿。
   */
  renderStart: optionalNonNegInt,
  /**
   * MD 渲染正文 / Recogito 容器坐标系半开终点（不含）；须严格大于 `renderStart`。
   */
  renderEnd: optionalNonNegInt,
  /**
   * 旧 VFS soft offset 起点（UTF-16；相对 VFS 全文；`[startOffset, endOffset)`）。
   * 非预览投影权威；缺省兼容旧草稿。
   */
  startOffset: optionalNonNegInt,
  /**
   * 旧 VFS soft offset 终点（不含）；须严格大于 `startOffset`。非预览投影权威。
   */
  endOffset: optionalNonNegInt,
  /** 宽松窗口起始行（1-based，含）；由 offset 派生；非预览投影权威。 */
  startLine: optionalPositiveInt,
  /** 宽松窗口结束行（1-based，含）；非预览投影权威。 */
  endLine: optionalPositiveInt,
  /** 起始列（1-based，含）；缺省表示自行首；非预览投影权威。 */
  startCol: optionalPositiveInt,
  /** 结束列（1-based，含）；缺省表示至行尾；非预览投影权威。 */
  endCol: optionalPositiveInt,
}).strict().superRefine((val, ctx) => {
  const { renderStart, renderEnd, startOffset, endOffset } = val;

  if ((renderStart == null) !== (renderEnd == null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "renderStart 与 renderEnd 须成对出现",
      path: renderStart != null ? ["renderEnd"] : ["renderStart"],
    });
  } else if (renderStart != null && renderEnd != null && renderStart >= renderEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "须满足 renderStart < renderEnd（半开区间 [start, end)）",
      path: ["renderEnd"],
    });
  }

  if ((startOffset == null) !== (endOffset == null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startOffset 与 endOffset 须成对出现",
      path: startOffset != null ? ["endOffset"] : ["startOffset"],
    });
  } else if (startOffset != null && endOffset != null && startOffset >= endOffset) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "须满足 startOffset < endOffset（半开区间 [start, end)）",
      path: ["endOffset"],
    });
  }
});

export type AnnotateDraft = z.infer<typeof annotateDraftSchema>;

/**
 * 发送管线批注草稿（仅文件形）。
 * 历史消息批注伪 path 仍由 `isMessageAnnotatePath` 识别并跳过 Undo。
 */
export type SendAnnotateDraft = AnnotateDraft;

/** `path.includes('__message__:')` → 历史消息批注伪 path（Undo 恢复须跳过）。 */
export function isMessageAnnotatePath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.includes("__message__:");
}
