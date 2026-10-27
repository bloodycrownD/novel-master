/**
 * composer 手输 token 高亮纯函数层：token 区间与分段切分。
 *
 * 明文 token 形如 `$技能名$` / `@路径@`：触发符开头、**同字符收尾**，bounded 自证——
 * 正则不再靠空白猜边界，胶囊后面的普通文字不会被吞进胶囊。
 * 字符类沿用既有口径：`@` 与 `$` 互相排除对方触发符并排除空白；
 * 相邻两颗 `$A$$B$` 天然可分（前一段 lastIndex 停在第二颗的起始 `$`）。
 * 空体 `$$` / `@@` 不命中；路径含 `@`、名字含 `$` 仍无法表达（既有口径，非新增限制）。
 * 行为契约见 `__tests__/fixtures/composer-token-cases.json`。
 */
const COMPOSER_TOKEN_RE = /@([^\s@$]+)@|\$([^\s$@]+)\$/g;

/** `@token` / `$token` 的完整区间（含触发符，end 为开区间下标）。 */
export type ComposerTokenRange = {
  readonly start: number;
  readonly end: number;
};

/** 区间文本形态是否合法（首尾同字符触发符，且整段恰好是一颗完整 token）。水化自愈用。 */
export function isValidTokenRangeText(plain: string, range: ComposerTokenRange): boolean {
  const {start, end} = range;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return false;
  }
  if (start < 0 || end > plain.length || start >= end) {
    return false;
  }
  const ranges = composerTokenRanges(plain.slice(start, end));
  return (
    ranges.length === 1 &&
    ranges[0].start === 0 &&
    ranges[0].end === end - start
  );
}

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

type ComposerSegment =
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
