/**
 * Highlight segment splitting for the smart sort rule editor test preview
 * (review-full/C-1, single source): the tested text is split into alternating
 * plain/matched segments using the matches' native offsets. Desktop and
 * mobile formerly carried line-by-line isomorphic local copies; both now
 * consume this core function via the public entry instead.
 *
 * Semantics (mirrors the former per-GUI implementations exactly):
 * - Offsets come from matchAll's native `index`; duplicate match texts cannot
 *   drift the split (indexOf-style re-lookup would).
 * - Zero-width matches (empty `text`) produce no empty matched segment and do
 *   not advance the cursor (callers skip them when rendering).
 * - A match ending exactly at the text end leaves no trailing plain segment.
 *
 * @module domain/smart-sort-rule/logic/split-smart-sort-highlight-segments
 */

/** One highlight segment: a slice of the tested text + whether it matched. */
export interface SmartSortHighlightSegment {
  readonly text: string;
  readonly matched: boolean;
}

/**
 * Minimal match shape consumed by {@link splitSmartSortHighlightSegments}:
 * start offset (matchAll native `index`) + full match text. Any superset
 * shape (e.g. `SmartSortPatternMatch` from `matchSmartSortPattern`) satisfies
 * it structurally, so callers can pass match results through directly.
 */
export interface SmartSortHighlightMatchInput {
  readonly index: number;
  readonly text: string;
}

/**
 * 按 matches 的原生偏移把测试文本切成普通段/匹配段交替（GUI 高亮渲染用）。
 *
 * matches 需按出现顺序排列（matchAll 天然有序）；入参用 `{index, text}`
 * 最小结构，各端携带自有 match 形态也能直接复用本切分逻辑。
 */
export function splitSmartSortHighlightSegments(
  text: string,
  matches: readonly SmartSortHighlightMatchInput[]
): SmartSortHighlightSegment[] {
  const segments: SmartSortHighlightSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.index > cursor) {
      segments.push({ text: text.slice(cursor, m.index), matched: false });
    }
    if (m.text.length > 0) {
      segments.push({ text: m.text, matched: true });
    }
    cursor = Math.max(cursor, m.index + m.text.length);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matched: false });
  }
  return segments;
}
