/**
 * Composer 草稿 wire 类型与 zod 校验（`chat_session.composer_draft_json`）。
 *
 * 形状 `{ text, attachments }`；attachments **仅** `source === 'attach'`
 *（解析时规范化剥掉 workplace / user_ops）。
 *
 * @module domain/chat/model/composer-draft.schema
 */

import { z } from "zod";
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
  const result = composerDraftSchema.safeParse({ text, attachments: kept });
  if (!result.success) {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
  return result.data;
}

/** 最小对象守卫（本文件内定义，不为它引新依赖）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 序列化草稿；空正文且无附件 → `null`（写入 SQL NULL）。
 * 写入前规范化：仅保留 `source === 'attach'`。
 */
export function serializeComposerDraftJson(
  draft:
    | { text: string; attachments: readonly MessageAttachment[] }
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
  return JSON.stringify(normalized);
}

/** 类型守卫：附件是否为 attach 源。 */
export function isComposerDraftAttachment(
  item: MessageAttachment
): item is ComposerDraftAttachment {
  return item.source === "attach";
}
