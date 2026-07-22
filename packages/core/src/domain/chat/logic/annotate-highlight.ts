/**
 * 划词批注高亮纯算法：按原文聚合 id、解析 mark 属性、长串优先排序、非重叠匹配；
 * 以及跨行内节点扁平可见文本索引 / 区间切分（D1–D4）。
 * DOM 收集与 wrap 留在 Desktop `preview-annotate` / Mobile `annotate-marks`。
 *
 * @module domain/chat/logic/annotate-highlight
 */

/** 非重叠查找 needle 在 haystack 中的全部起始下标。 */
export function findAllOccurrences(
  haystack: string,
  needle: string,
): number[] {
  if (needle.length === 0) {
    return [];
  }
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    out.push(at);
    from = at + needle.length;
  }
  return out;
}

/**
 * 按 originalText 聚合 draft id（同文多条共用一处下划线点击）。
 * 空 text 或空 id 跳过（采 Mobile 更严规则）。
 */
export function groupAnnotateIdsByOriginalText(
  drafts: readonly { readonly id: string; readonly originalText: string }[],
): Map<string, string[]> {
  const byText = new Map<string, string[]>();
  for (const d of drafts) {
    const text = d.originalText;
    if (!text || !d.id) {
      continue;
    }
    const list = byText.get(text);
    if (list == null) {
      byText.set(text, [d.id]);
    } else {
      list.push(d.id);
    }
  }
  return byText;
}

/** 解析 mark 上的 id 列表。 */
export function parseAnnotateIdsAttr(raw: string | null | undefined): string[] {
  if (raw == null || raw === "") {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 应用顺序：originalText 长度降序（长优先），重叠/嵌套时避免短针抢占。
 */
export function sortAnnotateTextsLongestFirst(
  texts: readonly string[],
): string[] {
  return [...texts].sort((a, b) => b.length - a.length);
}

/**
 * 入库 / 匹配用 needle 归一：`\u00a0→space` + trim。
 * 空串表示应跳过该条匹配。
 */
export function normalizeAnnotateNeedle(text: string): string {
  return text.replace(/\u00a0/g, " ").trim();
}

/**
 * Segment→haystack 归一：仅 `\u00a0→space`，**禁止** trim（保持与 raw `nodeValue` 1:1）。
 */
export function normalizeAnnotateSegmentText(raw: string): string {
  return raw.replace(/\u00a0/g, " ");
}

/** 某 segment 在扁平 haystack 中的半开区间。 */
export type FlatTextSegmentSpan = {
  readonly segmentIndex: number;
  /** haystack 内起点（含） */
  readonly flatStart: number;
  /** haystack 内终点（不含） */
  readonly flatEnd: number;
};

/** 扁平可见文本索引（单次匹配域）。 */
export type FlatTextIndex = {
  readonly haystack: string;
  readonly spans: readonly FlatTextSegmentSpan[];
};

/** flat 区间映射到某 segment 的局部半开区间（即 raw `nodeValue` 下标，见 D3）。 */
export type FlatSegmentLocalRange = {
  readonly segmentIndex: number;
  readonly start: number;
  readonly end: number;
};

/**
 * 按 D1 直拼规则构建扁平索引。
 *
 * **切断合同**：调用方须在 block / `br` / 表单元格边界处切断，
 * 仅将同一匹配域内的行内 Text segments 传入本函数（彼此直拼、无插入符）。
 * 跨 `<p>` / 跨单元格不得并入同一 `segments` 列表，否则会误命中。
 * 空串 segment 不贡献 haystack 字符，但仍保留 span（flatStart===flatEnd）以便下标对齐。
 */
export function buildFlatTextIndex(
  segments: readonly string[],
): FlatTextIndex {
  const parts: string[] = [];
  const spans: FlatTextSegmentSpan[] = [];
  let flatCursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const normalized = normalizeAnnotateSegmentText(segments[i]!);
    const flatStart = flatCursor;
    const flatEnd = flatStart + normalized.length;
    spans.push({ segmentIndex: i, flatStart, flatEnd });
    if (normalized.length > 0) {
      parts.push(normalized);
    }
    flatCursor = flatEnd;
  }
  return { haystack: parts.join(""), spans };
}

/**
 * 将 haystack 半开区间 `[flatStart, flatEnd)` 切分为各 segment 局部区间。
 * 因 segment 归一 1:1，返回的 `[start,end)` 可直接用于 raw `nodeValue` wrap（D3）。
 */
export function mapFlatRangeToSegments(
  flatStart: number,
  flatEnd: number,
  index: FlatTextIndex,
): FlatSegmentLocalRange[] {
  if (flatEnd <= flatStart) {
    return [];
  }
  const out: FlatSegmentLocalRange[] = [];
  for (const span of index.spans) {
    const overlapStart = Math.max(flatStart, span.flatStart);
    const overlapEnd = Math.min(flatEnd, span.flatEnd);
    if (overlapStart >= overlapEnd) {
      continue;
    }
    out.push({
      segmentIndex: span.segmentIndex,
      start: overlapStart - span.flatStart,
      end: overlapEnd - span.flatStart,
    });
  }
  return out;
}
