/**
 * Composer 草稿 wire 类型与 zod 校验（`chat_session.composer_draft_json`）。
 *
 * 形状 `{ text, attachments, tokenRanges? }`；attachments **仅** `source === 'attach'`
 *（解析时规范化剥掉 workplace / user_ops）；tokenRanges 为可选的确认胶囊区间，
 * 语义上 `undefined`（旧草稿，允许兜底扫描）≠ `[]`（确认无胶囊）。
 *
 * @module domain/chat/model/composer-draft.schema
 */

import { z } from "zod";
import { isRecord } from "@/common/guards.js";
import {
  messageAttachmentObjectSchema,
  messageAttachmentSchema,
  type MessageAttachment,
} from "./message-attachment.schema.js";

/** Composer 草稿中允许持久的附件（仅 attach）。 */
export const composerDraftAttachmentSchema = messageAttachmentObjectSchema
  .omit({ source: true })
  .extend({ source: z.literal("attach") });

export type ComposerDraftAttachment = z.infer<
  typeof composerDraftAttachmentSchema
>;

/**
 * 单个确认胶囊区间：`[start, end)`，UTF-16 码元偏移。
 *
 * 只校验形状（非负整数 + `start < end`）。**零长度区间一律拒收**：JS 侧 remap 会保留
 * 零长度区间、native 侧 `RangeEditAdjustment` 会剔除，两侧行为不一，不让它进 wire。
 * `text.length` 越界、区间有序性、重叠都不在 schema 层校验——越界由消费侧防御。
 */
const composerDraftTokenRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((range) => range.start < range.end, {
    message: "tokenRange 需满足 start < end（零长度区间拒收）",
  });

const composerDraftTokenRangesSchema = z.array(composerDraftTokenRangeSchema);

/** Composer 草稿中的确认胶囊区间（storage 层与 UI 的 token-ranges 共用）。 */
export type ComposerDraftTokenRange = z.infer<
  typeof composerDraftTokenRangeSchema
>;

/** Composer 草稿对象。 */
export const composerDraftSchema = z
  .object({
    text: z.string(),
    attachments: z
      .array(messageAttachmentSchema)
      .transform((items) =>
        items.filter(
          (item): item is ComposerDraftAttachment => item.source === "attach"
        )
      ),
    /**
     * 确认胶囊区间。**不设 default**：`undefined`（旧草稿，允许消费侧兜底扫描）
     * 与 `[]`（确认无胶囊，禁止扫描）语义不同，不能被默认值抹平。
     */
    tokenRanges: composerDraftTokenRangesSchema.optional(),
  })
  .strict();

export type ComposerDraft = z.infer<typeof composerDraftSchema>;

/** 空草稿（等价于列 NULL / 缺省）。 */
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
};

/**
 * 解析 `composer_draft_json`；NULL/空/非法 → 空草稿。
 * 含非 attach 的附件会被剥掉。
 *
 * 口径（逐条降级，与 {@link parseAttachmentsJson} 对齐）：**非法附件逐条丢弃、
 * 正文永不因附件而丢**；只有顶层不是 `{ text, attachments }` 形状时才整体降级为空草稿。
 * 附件形态跨版本演进过，整对象一次判废会让「一条坏附件」把用户写了一半的正文一起吃掉。
 * 写侧（serializeComposerDraftJson）保持严格，宽容不回灌。
 *
 * `tokenRanges` 同属「坏了只丢自己」：字段缺失或非法 → 结果对象**不含该自有键**
 * （等价于「旧草稿，允许兜底扫描」），text/attachments 照常保留。
 */
export function parseComposerDraftJson(
  raw: string | null | undefined
): ComposerDraft {
  if (raw == null || raw === "") {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
  // 守卫：parsed 可能是 number / string / array / null，形状不对时无粒度可 salv。
  if (!isRecord(parsed)) {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
  // text 单独取，让「正文不因附件而丢」成为结构性保证，而不是靠运气。
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const items = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  const kept = items.flatMap((item) => {
    const r = messageAttachmentSchema.safeParse(item);
    return r.success ? [r.data] : [];
  });
  // kept 过滤后仍喂回 composerDraftSchema：复用既有「非 attach 源剥掉」transform
  // 完成来源分档、保住顶层 .strict() 对未知键的拒绝。
  // tokenRanges **不进这次调用**：它单独校验，非法 ranges 只该丢自己，不牵连正文。
  const result = composerDraftSchema.safeParse({ text, attachments: kept });
  if (!result.success) {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
  // 逐字段重建而不直接回 result.data：tokenRanges 缺失/非法时**不写自有键**，
  // 否则 zod optional 自带的 `tokenRanges: undefined` 会让既有
  // `node:assert/strict` deepEqual 断言（`{ text, attachments }` 形状）翻红。
  const draft: ComposerDraft = {
    text: result.data.text,
    attachments: result.data.attachments,
  };
  const tokenRanges = parseTokenRangesField(parsed.tokenRanges);
  if (tokenRanges !== undefined) {
    draft.tokenRanges = tokenRanges;
  }
  return draft;
}

/**
 * 解析 `tokenRanges` 字段（单独 safeParse，不与 text/attachments 共用一次调用）。
 *
 * 缺失 / `null` / 非数组 / 任一条目非法 → `undefined`（调用方据此不写自有键）；
 * 合法（含空数组 `[]`，表示「确认无胶囊」）→ 返回数组。非法条目**整字段**降级，
 * 不做逐条丢弃——区间数组是原子的确认态，半份区间比没有更危险。
 */
function parseTokenRangesField(
  value: unknown
): ComposerDraftTokenRange[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = composerDraftTokenRangesSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * 序列化草稿；空正文且无附件 → `null`（写入 SQL NULL）。
 * 写入前规范化：仅保留 `source === 'attach'`。
 *
 * `tokenRanges` 有值时**过滤非法区间后透传**：丢掉 `start >= end`、负数、非整数等坏条目，
 * 其余照写；全被过滤写 `[]`，**不抛错**——落库链永不被 ranges 炸，与 parse 同口径。
 * `undefined`（旧草稿语义，允许兜底扫描）不写该字段；`[]`（确认无胶囊）照写。
 */
export function serializeComposerDraftJson(
  draft:
    | {
        text: string;
        attachments: readonly MessageAttachment[];
        /** 确认胶囊区间；`undefined` 表示不写字段，见 D1 的 undefined ≠ `[]` 口径。 */
        tokenRanges?: readonly ComposerDraftTokenRange[];
      }
    | null
    | undefined
): string | null {
  if (draft == null) {
    return null;
  }
  const attachments = draft.attachments.filter(
    (item): item is ComposerDraftAttachment => item.source === "attach"
  );
  if (draft.text === "" && attachments.length === 0) {
    return null;
  }
  const normalized: ComposerDraft = {
    text: draft.text,
    attachments,
  };
  if (draft.tokenRanges !== undefined) {
    normalized.tokenRanges = draft.tokenRanges.filter(
      isComposerDraftTokenRange
    );
  }
  return JSON.stringify(normalized);
}

/**
 * 区间条目是否可落库（serialize 的过滤谓词，与 schema 的元素校验同口径）。
 * 参数接受 `unknown`：wire 数据可能来自带外写入，类型标注挡不住运行期垃圾。
 */
function isComposerDraftTokenRange(
  value: unknown
): value is ComposerDraftTokenRange {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { start, end } = value as { start?: unknown; end?: unknown };
  return (
    typeof start === "number" &&
    Number.isInteger(start) &&
    start >= 0 &&
    typeof end === "number" &&
    Number.isInteger(end) &&
    end >= 0 &&
    start < end
  );
}

/** 类型守卫：附件是否为 attach 源。 */
export function isComposerDraftAttachment(
  item: MessageAttachment
): item is ComposerDraftAttachment {
  return item.source === "attach";
}
