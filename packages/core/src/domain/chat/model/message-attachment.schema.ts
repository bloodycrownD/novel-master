/**
 * 消息附件 wire 类型与 zod 校验（`attachments_json`）。
 *
 * @module domain/chat/model/message-attachment.schema
 */

import { z } from "zod";

/** 单条消息附件。 */
export const messageAttachmentSchema = z
  .object({
    name: z.string().min(1),
    source: z.enum(["workplace", "attach", "user_ops"]),
    type: z.enum(["text", "image", "dir"]),
    /** workplace/attach 落库可长期为 null；user_ops 为 action XML。 */
    content: z.string().nullable(),
    /** workplace/attach 的逻辑 path。 */
    path: z.string().optional(),
  })
  .strict();

/** 消息附件数组（`attachments_json`）。 */
export const messageAttachmentsSchema = z.array(messageAttachmentSchema);

export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export type MessageAttachments = z.infer<typeof messageAttachmentsSchema>;

/**
 * 解析 `attachments_json`；NULL/空/非法 → `undefined`。
 */
export function parseAttachmentsJson(
  raw: string | null | undefined,
): MessageAttachment[] | undefined {
  if (raw == null || raw === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = messageAttachmentsSchema.safeParse(parsed);
  if (!result.success) {
    return undefined;
  }
  return result.data;
}

/**
 * 序列化附件数组；空/undefined → `null`（写入 SQL NULL）。
 */
export function serializeAttachmentsJson(
  attachments: readonly MessageAttachment[] | undefined | null,
): string | null {
  if (attachments == null || attachments.length === 0) {
    return null;
  }
  return JSON.stringify(attachments);
}
