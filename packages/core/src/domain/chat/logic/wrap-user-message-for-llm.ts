/**
 * 将用户原文 + 已 hydrate 附件 wrap 为 LLM 可见 XML（不写回 content_json）。
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
 * 任一 source 的 section 若 body 全空则省略该标签。
 * 若全部 section 都无非空 body → **直接返回 `plainText`**，不包空 `<attachment>`。
 *
 * 调用方须保证 workplace/attach 的 `content` 已 hydrate（文件块 / 目录树 / 短提示）。
 * `user_ops` 的 `content` 为 action XML。
 */
export function wrapUserMessageForLlm(
  plainText: string,
  attachments: readonly MessageAttachment[] | undefined | null,
): string {
  if (attachments == null || attachments.length === 0) {
    return plainText;
  }

  const workplace = attachments.filter((a) => a.source === "workplace");
  const attach = attachments.filter((a) => a.source === "attach");
  const userOps = attachments.filter((a) => a.source === "user_ops");

  const sections: string[] = [];
  if (workplace.length > 0) {
    const body = sectionBody(workplace);
    if (body !== "") {
      sections.push(`  <workplace>\n${body}\n  </workplace>`);
    }
  }
  if (attach.length > 0) {
    const body = sectionBody(attach);
    if (body !== "") {
      sections.push(`  <attach>\n${body}\n  </attach>`);
    }
  }
  if (userOps.length > 0) {
    const body = sectionBody(userOps);
    if (body !== "") {
      sections.push(`  <user-ops>\n${body}\n  </user-ops>`);
    }
  }

  if (sections.length === 0) {
    return plainText;
  }

  return [
    "<attachment>",
    sections.join("\n"),
    "</attachment>",
    "<user-input>",
    plainText,
    "</user-input>",
  ].join("\n");
}
