/**
 * Composer token 插入纯函数：四条插入路径（@ 选择器 / $ 选择器 / @ typeahead /
 * $ typeahead）共用的「补前后空格 + 拼接 + 算光标」。
 * 组件侧只负责 mention ref 优先与纯文本 fallback 的提交（见 ChatComposer 的
 * commitComposerText）。
 */
import type {MessageAttachment} from '@novel-master/core/chat';

export type ComposerTokenInsertion = {
  readonly text: string;
  readonly cursor: number;
};

/**
 * 用 token 替换 `[replaceStart, cursor)` 区间：
 * - 前段非空且不以空白结尾时补一个前导空格（typeahead 路径因触发字符前必有
 *   空白，该前导空格恒为空，与 replaceActiveAtWithToken 行为一致）；
 * - 后段为空或非空白开头时补尾空格；
 * - 多 token（@ 选择器多选）以空格连接；
 * - 光标落在插入段末尾。
 */
export function buildTokenInsertion(
  text: string,
  cursor: number,
  replaceStart: number,
  token: string | readonly string[],
): ComposerTokenInsertion {
  const before = text.slice(0, replaceStart);
  const after = text.slice(cursor);
  const gapBefore = before.length === 0 || /\s$/.test(before) ? '' : ' ';
  const joined = typeof token === 'string' ? token : token.join(' ');
  const gapAfter = after.length === 0 || !/^\s/.test(after) ? ' ' : '';
  const inserted = `${gapBefore}${joined}${gapAfter}`;
  return {
    text: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length,
  };
}

/** draft 持久化只保留状态 chip（workplace / user_ops）；文件引用由正文 `@` 扫描。 */
export function statusOnlyComposerAttachments(
  attachments: readonly MessageAttachment[],
): MessageAttachment[] {
  return attachments.filter(
    a => a.source === 'workplace' || a.source === 'user_ops',
  );
}
