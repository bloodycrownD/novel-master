/**
 * 将用户原文 + 已 hydrate 附件 wrap 为 LLM 可见 XML（不写回 content_json）。
 *
 * 增量统一为单一 `<user-ops>`；action 顺序钉死：attach → workplace（历史只读兼容）→ user_ops/annotate。
 * 可保留外层 `<attachment>` 与 `<user-input>` 分界。
 * 送模型时 body 每行非空前缀 4 空格；落库 action XML 保持顶格（本函数不改附件 content）。
 * 运行时可选注入 `<extra-info>` 纯文本块（customAttach），位置在 `</user-ops>` 之后、`</attachment>` 之前。
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

/** 送 LLM 时对 body 每行非空前缀 4 空格（落库 XML 仍顶格）。 */
function indentUserOpsBody(body: string): string {
  return body
    .split("\n")
    .map((line) => (line.length === 0 ? line : `    ${line}`))
    .join("\n");
}

/** `<extra-info>` 纯文本块：每行缩 4 空格（与 user-ops body 同缩进风格）。 */
function renderExtraInfoBlock(extraInfo: string): string {
  const indented = indentUserOpsBody(extraInfo.trim());
  return [`  <extra-info>`, indented, `  </extra-info>`].join("\n");
}

/**
 * 无附件 → 恒等原文；有附件 → `<attachment>…</attachment><user-input>…</user-input>`。
 *
 * 全部非空 attachment 的 action XML 拼进单一 `<user-ops>`；
 * 顺序：`userAttach`（attach）→ `workplaceChange`（workplace，历史只读兼容）→ 手改/annotate（user_ops）。
 * 若全部 body 空 → **直接返回 `plainText`**，不包空 `<attachment>`。
 *
 * `extraInfo`（customAttach）非空时在 `</user-ops>` 之后、`</attachment>` 之前插入 `<extra-info>` 纯文本块；
 * 无附件 body 但 extraInfo 非空时，仍会包外层 `<attachment>` 以承载该块。
 *
 * 调用方须保证 workplace/attach 的 `content` 已 hydrate 为 action XML。
 * `user_ops` 的 `content` 为 action XML。
 */
export function wrapUserMessageForLlm(
  plainText: string,
  attachments: readonly MessageAttachment[] | undefined | null,
  extraInfo?: string,
): string {
  const hasAttachments = attachments != null && attachments.length > 0;
  let body = "";
  if (hasAttachments) {
    // 顺序钉死：attach → workplace（历史只读兼容）→ user_ops（含 annotate）
    const attach = attachments!.filter((a) => a.source === "attach");
    const workplace = attachments!.filter((a) => a.source === "workplace");
    const userOps = attachments!.filter((a) => a.source === "user_ops");
    body = sectionBody([...attach, ...workplace, ...userOps]);
  }

  const extraInfoBody =
    typeof extraInfo === "string" && extraInfo.trim().length > 0
      ? renderExtraInfoBlock(extraInfo)
      : null;

  // 无附件 body 且无 extra-info：恒等原文，不包空 `<attachment>`
  if (body === "" && extraInfoBody == null) {
    return plainText;
  }

  const lines: string[] = ["<attachment>"];
  if (body !== "") {
    lines.push(`  <user-ops>`);
    lines.push(indentUserOpsBody(body));
    lines.push(`  </user-ops>`);
  }
  if (extraInfoBody != null) {
    lines.push(extraInfoBody);
  }
  lines.push("</attachment>", "<user-input>", plainText, "</user-input>");
  return lines.join("\n");
}
