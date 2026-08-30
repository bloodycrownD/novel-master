/**
 * 将用户原文 + 已 hydrate 附件 wrap 为 LLM 可见 XML（不写回 content_json）。
 *
 * 增量统一为单一 `<user-ops>`；action 顺序钉死：attach → workplace（历史只读兼容）→ annotate。
 * 手改 user_ops 附件不进 prompt（D2：仅 `action === "annotate"` 保留，含历史消息）。
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
 * `extraInfo`（customAttach）非空时在 `</user-ops>` 之后、`</attachment>` 之前插入 `<extra-info>` 纯文本块。
 *
 * 边界：当无附件 body 但 `extraInfo` 非空时，仍会包外层 `<attachment>` 以承载 `<extra-info>`，
 * 此时不含 `<user-ops>`（仅 `<extra-info>` + `<user-input>`）。上游解析器应按「外层 `<attachment>` 是否存在」
 * 判定，而非假定 `<user-ops>` 必然出现。
 *
 * 调用方须保证 workplace/attach 的 `content` 已 hydrate 为 action XML。
 * `user_ops` 的 `content` 为 action XML。
 */
export function wrapUserMessageForLlm(
  plainText: string,
  attachments: readonly MessageAttachment[] | undefined | null,
  extraInfo?: string
): string {
  const hasAttachments = attachments != null && attachments.length > 0;
  let body = "";
  if (hasAttachments) {
    // 顺序钉死：attach → workplace（历史只读兼容）→ annotate（user_ops 中仅批注，D2）
    const attach = attachments!.filter((a) => a.source === "attach");
    const workplace = attachments!.filter((a) => a.source === "workplace");
    // D2：user_ops 仅保留批注附件；历史手改附件（write/edit 等）不再进 prompt
    const annotate = attachments!.filter(
      (a) => a.source === "user_ops" && a.action === "annotate"
    );
    body = sectionBody([...attach, ...workplace, ...annotate]);
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
