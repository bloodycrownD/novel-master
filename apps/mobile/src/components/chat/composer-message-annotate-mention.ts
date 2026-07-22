/**
 * 消息正文批注 mention：独立 trigger（非 `@`），与 `@path` 硬分流。
 * 仅解析 / 程序化插入；typeahead suggest 恒空。
 * 禁止进 chipsFromAnnotateStore / 气泡下划线。
 */

/** 推荐非 `@` 单字符 trigger（内部 markup `{§}[短标签](draftId)`）。 */
export const MESSAGE_ANNOTATE_TRIGGER = '§';

/** 短标签原文截断上限（超出加 `…`）。 */
export const MESSAGE_ANNOTATE_LABEL_MAX = 12;

/**
 * 可见短标签：`批:「` + 截断原文 + `」`。
 * 内嵌 `@` 显示为全角 `＠`（辅；防扫主合同仍靠发送前剥离）。
 */
export function formatMessageAnnotateShortLabel(originalText: string): string {
  const raw = originalText.replace(/\u00a0/g, ' ').trim();
  const truncated =
    raw.length <= MESSAGE_ANNOTATE_LABEL_MAX
      ? raw
      : `${raw.slice(0, MESSAGE_ANNOTATE_LABEL_MAX)}…`;
  const display = truncated.replace(/@/g, '＠');
  return `批:「${display}」`;
}

/** 内部 mention markup：`{§}[短标签](draftId)`。 */
export function formatMessageAnnotateMentionMarkup(
  draftId: string,
  originalText: string,
): string {
  const name = formatMessageAnnotateShortLabel(originalText);
  return `{${MESSAGE_ANNOTATE_TRIGGER}}[${name}](${draftId})`;
}

/** 从 mention 内部值提取消息批注 draft id。 */
export function listMessageAnnotateDraftIdsInMentionValue(
  mentionValue: string,
): string[] {
  const re = new RegExp(
    `\\{${escapeRegExp(MESSAGE_ANNOTATE_TRIGGER)}\\}\\[([^\\]]*)\\]\\(([^)]+)\\)`,
    'g',
  );
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(mentionValue)) != null) {
    const id = m[2] ?? '';
    if (id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
