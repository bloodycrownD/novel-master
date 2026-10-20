/**
 * Composer token 插入纯函数：四条插入路径（@ 选择器 / $ 选择器 / @ typeahead /
 * $ typeahead）共用的「补前后空格 + 拼接 + 算光标」。
 * 组件侧只负责 mention ref 优先与纯文本 fallback 的提交（见 ChatComposer 的
 * commitComposerText）。
 */
import type {MessageAttachment} from '@novel-master/core/chat';
import type {ComposerTokenRange} from './composer-highlight';

export type ComposerTokenInsertion = {
  readonly text: string;
  readonly cursor: number;
  /**
   * 插入段内每个 token 的完整区间（含触发符，下标针对返回值 `text`；
   * 2026-10-07 胶囊确认制：引用落文时随插入一并登记，手输永不登记）。
   * 多 token 以空格连接时逐个给出，区间互不相邻。
   */
  readonly tokenRanges: readonly ComposerTokenRange[];
};

/**
 * 用 token 替换 `[replaceStart, cursor)` 区间（chip 模型，2026-10-20 真机轮
 * 用户定口径）：**不插入任何分隔空格**——胶囊之间、胶囊与前后文本之间直接
 * 相邻，视觉分隔由原生胶囊盒内留白（RoundedBackgroundSpan gapHorizontal）
 * 承担；明文 token（`$A$B`）由触发符天然切分，用户想加空格自行输入。
 * - 多 token（@ 选择器多选）也直接拼接（无连接空格）；
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
  const tokens = typeof token === 'string' ? [token] : token;
  const joined = tokens.join('');
  const tokenRanges: ComposerTokenRange[] = [];
  let offset = before.length;
  for (const item of tokens) {
    tokenRanges.push({start: offset, end: offset + item.length});
    offset += item.length;
  }
  return {
    text: `${before}${joined}${after}`,
    cursor: before.length + joined.length,
    tokenRanges,
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
