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
 * 调用方须保证 workplace/attach 的 `content` 已 hydrate（文件块 / 目录树）。
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
    sections.push(
      body === ""
        ? "  <workplace></workplace>"
        : `  <workplace>\n${body}\n  </workplace>`,
    );
  }
  if (attach.length > 0) {
    const body = sectionBody(attach);
    sections.push(
      body === ""
        ? "  <attach></attach>"
        : `  <attach>\n${body}\n  </attach>`,
    );
  }
  if (userOps.length > 0) {
    const body = sectionBody(userOps);
    sections.push(
      body === ""
        ? "  <user-ops></user-ops>"
        : `  <user-ops>\n${body}\n  </user-ops>`,
    );
  }

  // 仅有空壳（无任一 section）时仍 wrap，避免「有 attachments 却恒等」歧义
  if (sections.length === 0) {
    sections.push("  <attach></attach>");
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
