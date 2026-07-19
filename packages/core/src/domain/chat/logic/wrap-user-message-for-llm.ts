/**
 * 将用户原文 + 已 hydrate 附件 wrap 为 LLM 可见 XML（不写回 content_json）。
 *
 * 增量统一为单一 `<user-ops>`；action 顺序钉死：attach → workplace → user_ops/annotate。
 * 可保留外层 `<attachment>` 与 `<user-input>` 分界。
 *
 * @module domain/chat/logic/wrap-user-message-for-llm
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";

function sectionBody(attachments: readonly MessageAttachment[]): string {
  return attachments
    .map((a) => (a.content ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * 无附件 → 恒等原文；有附件 → `<attachment>…</attachment><user-input>…</user-input>`。
 *
 * 全部非空 attachment 的 action XML 拼进单一 `<user-ops>`；
 * 顺序：`userAttach`（attach）→ `workplaceChange`（workplace）→ 手改/annotate（user_ops）。
 * 若全部 body 空 → **直接返回 `plainText`**，不包空 `<attachment>`。
 *
 * 调用方须保证 workplace/attach 的 `content` 已 hydrate 为 action XML。
 * `user_ops` 的 `content` 为 action XML。
 */
export function wrapUserMessageForLlm(
  plainText: string,
  attachments: readonly MessageAttachment[] | undefined | null,
): string {
  if (attachments == null || attachments.length === 0) {
    return plainText;
  }

  // 顺序钉死：attach → workplace → user_ops（含 annotate）
  const attach = attachments.filter((a) => a.source === "attach");
  const workplace = attachments.filter((a) => a.source === "workplace");
  const userOps = attachments.filter((a) => a.source === "user_ops");

  const body = sectionBody([...attach, ...workplace, ...userOps]);
  if (body === "") {
    return plainText;
  }

  return [
    "<attachment>",
    `  <user-ops>`,
    body,
    `  </user-ops>`,
    "</attachment>",
    "<user-input>",
    plainText,
    "</user-input>",
  ].join("\n");
}
