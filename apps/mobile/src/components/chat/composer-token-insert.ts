/**
 * Composer token 插入纯函数：四条插入路径（@ 选择器 / $ 选择器 / @ typeahead /
 * $ typeahead）共用的「零分隔空格拼接 + 算光标」，外加 Picker 确认前的
 * 确认区间守卫（dock 与全屏共用）。
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
   * 多 token 直接拼接（无连接空格）时按出现顺序逐个给出，chip 贴邻时
   * 区间首尾相接（前一颗 end == 后一颗 start）。
   */
  readonly tokenRanges: readonly ComposerTokenRange[];
};

/**
 * 用 token 替换 `[replaceStart, cursor)` 区间（chip 模型，2026-10-20 真机轮
 * 用户定口径）：**不插入任何分隔空格**——胶囊之间、胶囊与前后文本之间直接
 * 相邻，视觉分隔由原生胶囊盒内留白（RoundedBackgroundSpan gapHorizontal）
 * 承担；明文 token（`$A$$B$` / `@a@@b@`）由成对触发符天然切分，用户想加空格自行输入。
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

/**
 * Picker 确认的「活动查询」守卫（dock 与全屏共用，2026-10-20 真机轮定）。
 *
 * 查询区 `[start, end)` 若整段落在一颗**已确认胶囊**区间内，它就是引用落文的
 * 成品胶囊（光标贴其尾部——chip 零空格插入后光标就在 token 右缘），不是用户
 * 手输的半截查询：确认时**不替换、纯插入**。否则 `findActiveAtQuery` 会把整颗
 * 已插入 token 当成活跃查询，第二次确认把上一颗整颗替换掉（「连插互替换」的
 * 真因）。真手输的 `$半截` / `@半截` 不在任何确认区间内，替换补全语义不变。
 */
export function queryWithinConfirmedRange(
  ranges: readonly ComposerTokenRange[],
  start: number,
  end: number,
): boolean {
  return ranges.some(r => r.start <= start && end <= r.end);
}

/** draft 持久化只保留状态 chip（workplace / user_ops）；文件引用由正文 `@` 扫描。 */
export function statusOnlyComposerAttachments(
  attachments: readonly MessageAttachment[],
): MessageAttachment[] {
  return attachments.filter(
    a => a.source === 'workplace' || a.source === 'user_ops',
  );
}
