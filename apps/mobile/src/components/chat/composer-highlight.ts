/**
 * composer 手输 token 高亮纯函数层：token 区间与分段切分。
 *
 * 正则口径严格对齐桌面蓝本
 * `apps/desktop/renderer/features/chat/ComposerAtPathInput.tsx` 的 `AT_TOKEN_RE`：
 * `@` 与 `$` 各自的字符类互相排除对方（`@a$b` 不互吞，成两个独立 token）；
 * token 以空白截止；无「前置须空白」要求（`a@b` 中 `@b` 命中）；
 * 孤立 `$`（后随空白/结尾/`$`/`@`）不成 token，原文保留。
 */
const COMPOSER_TOKEN_RE = /@([^\s@$]+)|\$([^\s$@]+)/g;

/** `@token` / `$token` 的完整区间（含触发符，end 为开区间下标）。 */
export type ComposerTokenRange = {
  readonly start: number;
  readonly end: number;
};

/** 扫描 plain，返回全部 token 完整区间（按出现顺序，互不重叠）。 */
export function composerTokenRanges(
  plain: string,
): readonly ComposerTokenRange[] {
  const ranges: ComposerTokenRange[] = [];
  COMPOSER_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMPOSER_TOKEN_RE.exec(plain)) != null) {
    ranges.push({start: match.index, end: match.index + match[0].length});
  }
  return ranges;
}

export type ComposerSegment =
  | {readonly kind: 'plain'; readonly text: string}
  | {readonly kind: 'token'; readonly text: string};

/**
 * 将 plain 切分为普通文本段与 token 段（供高亮层逐段渲染）。
 *
 * token 区间互不重叠且按序排列，plain 段天然不会相邻（无需额外合并）；
 * 空串与纯文本均返回单段 plain（空串为 `{text: '', kind: 'plain'}`）。
 */
export function splitComposerTokenSegments(
  plain: string,
): readonly ComposerSegment[] {
  const ranges = composerTokenRanges(plain);
  if (ranges.length === 0) {
    return [{kind: 'plain', text: plain}];
  }

  const segments: ComposerSegment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (cursor < range.start) {
      segments.push({kind: 'plain', text: plain.slice(cursor, range.start)});
    }
    segments.push({kind: 'token', text: plain.slice(range.start, range.end)});
    cursor = range.end;
  }

  if (cursor < plain.length) {
    segments.push({kind: 'plain', text: plain.slice(cursor)});
  }

  return segments;
}
