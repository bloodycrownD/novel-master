/**
 * 消息附件 wire 类型与 zod 校验（`attachments_json`）。
 *
 * @module domain/chat/model/message-attachment.schema
 */

import { z } from "zod";

/** 空 path 时落库 `name` 占位（满足 `min(1)`）。 */
export const NO_PATH_ATTACHMENT_NAME = "__no_path__";

/**
 * 落库 `name`：有非空 path 时与 path 逐字相同；否则 `__no_path__`。
 * UI 永不把 `name` 当 chip 文案真源。
 */
export function attachmentStorageName(
  path: string | null | undefined,
): string {
  if (path == null || path === "") {
    return NO_PATH_ATTACHMENT_NAME;
  }
  return path;
}

/** 附件 action 枚举（提示词 `<action name>` / 落库真源）。 */
export const messageAttachmentActionSchema = z.enum([
  "delete",
  "write",
  "edit",
  "mkdir",
  "rename",
  "workplaceChange",
  "userAttach",
  "annotate",
]);

export type MessageAttachmentAction = z.infer<
  typeof messageAttachmentActionSchema
>;

/** 展示 tag 形态：`write:/x`、`edit:/a→/b` 等（禁止写入新附件 `name`）。 */
const DISPLAY_TAG_NAME_RE = /^\w+:\//;

/**
 * 附件对象底座（无 refine，供 `.omit` / composer draft 组合）。
 */
export const messageAttachmentObjectSchema = z
  .object({
    name: z.string().min(1),
    source: z.enum(["workplace", "attach", "user_ops"]),
    type: z.enum(["text", "image", "dir"]),
    /** workplace/attach 落库可长期为 null；发送后均为 action XML。 */
    content: z.string().nullable(),
    /** workplace/attach/user_ops 的逻辑 path。 */
    path: z.string().optional(),
    /** 结构化 action；新写入应必填；历史可缺省。 */
    action: messageAttachmentActionSchema.optional(),
  })
  .strict();

/** 单条消息附件（含新写入 name 禁展示 tag / 须等于 storage name 校验）。 */
export const messageAttachmentSchema = messageAttachmentObjectSchema.superRefine(
  (val, ctx) => {
    // 新写入（带 action）禁止把展示 tag 写入 name
    if (val.action != null && DISPLAY_TAG_NAME_RE.test(val.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "name 禁止为 action:path 展示 tag（须 name=path）",
        path: ["name"],
      });
    }
    // 有 action 时 name 须与 attachmentStorageName(path) 一致
    if (val.action != null) {
      const expected = attachmentStorageName(val.path);
      if (val.name !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `有 action 时 name 须等于 attachmentStorageName(path)（期望 ${expected}）`,
          path: ["name"],
        });
      }
    }
  },
);

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
