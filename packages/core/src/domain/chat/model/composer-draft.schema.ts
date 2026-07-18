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
  messageAttachmentSchema,
  type MessageAttachment,
} from "./message-attachment.schema.js";

/** Composer 草稿中允许持久的附件（仅 attach）。 */
export const composerDraftAttachmentSchema = messageAttachmentSchema
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
          (item): item is ComposerDraftAttachment => item.source === "attach",
        ),
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
 */
export function parseComposerDraftJson(
  raw: string | null | undefined,
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
  const result = composerDraftSchema.safeParse(parsed);
  if (!result.success) {
    return { ...EMPTY_COMPOSER_DRAFT, attachments: [] };
  }
  return result.data;
}

/**
 * 序列化草稿；空正文且无附件 → `null`（写入 SQL NULL）。
 * 写入前规范化：仅保留 `source === 'attach'`。
 */
export function serializeComposerDraftJson(
  draft:
    | { text: string; attachments: readonly MessageAttachment[] }
    | null
    | undefined,
): string | null {
  if (draft == null) {
    return null;
  }
  const attachments = draft.attachments.filter(
    (item): item is ComposerDraftAttachment => item.source === "attach",
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
  item: MessageAttachment,
): item is ComposerDraftAttachment {
  return item.source === "attach";
}
