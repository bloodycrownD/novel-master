/**
 * 划词批注高亮纯算法：按原文聚合 id、解析 mark 属性、长串优先排序、非重叠匹配；
 * 跨行内节点扁平可见文本索引 / 区间切分；源文件窗口内匹配（H5）。
 * DOM 收集与 wrap 留在 Desktop `preview-annotate` / Mobile `annotate-marks`。
 *
 * @module domain/chat/logic/annotate-highlight
 */

import {
  expandSoftRangeOnce,
  hasValidAnnotateSoftRange,
  sliceSourceBySoftRange,
  type AnnotateSoftRangeFields,
  type AnnotateSoftSourceRange,
} from "./annotate-source-range.js";

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
 * 入库 / 匹配用 needle 归一（H12）：`\u00a0→space`，删除 `\t`，
 * `\r\n`/`\r`→`\n`，**保留 `\n`**，再 trim。
 * 空串表示应跳过该条匹配。plain/`pre` 多行可命中。
 */
export function normalizeAnnotateNeedle(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

/**
 * 表域跨格专用：在 {@link normalizeAnnotateNeedle} 基础上再删 `\n`，
 * 使相邻格直拼 haystack 可命中（H12/H13；勿用于 plain/`pre`）。
 */
export function normalizeAnnotateNeedleStripNewlines(text: string): string {
  return normalizeAnnotateNeedle(text).replace(/\n/g, "");
}

/** 源文件匹配策略（窗口 → 扩大一次 → 全文）。 */
export type AnnotateSourceMatchStrategy = "window" | "expanded" | "full";

/** 源文件中一次原文命中。 */
export type AnnotateSourceMatch = {
  /** 命中起始下标（0-based，相对全文）。 */
  readonly index: number;
  /** 命中在原文中的字符长度。 */
  readonly length: number;
  readonly strategy: AnnotateSourceMatchStrategy;
};

/**
 * 与 needle 同规则归一 haystack，并保留归一下标 → 原文下标映射。
 * trim 仅作用于 needle；haystack 不 trim（保持定位）。
 */
function normalizeHaystackWithIndexMap(haystack: string): {
  readonly normalized: string;
  /** normalized[i] 对应原文下标 */
  readonly indexMap: readonly number[];
} {
  const chars: string[] = [];
  const indexMap: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i]!;
    if (ch === "\u00a0") {
      chars.push(" ");
      indexMap.push(i);
      continue;
    }
    if (ch === "\t") {
      continue;
    }
    if (ch === "\r") {
      if (haystack[i + 1] === "\n") {
        i++;
      }
      chars.push("\n");
      indexMap.push(i);
      continue;
    }
    chars.push(ch);
    indexMap.push(i);
  }
  return { normalized: chars.join(""), indexMap };
}

function findFirstNormalizedInHaystack(
  haystack: string,
  needleRaw: string,
): { readonly index: number; readonly length: number } | null {
  const needle = normalizeAnnotateNeedle(needleRaw);
  if (!needle) {
    return null;
  }
  const { normalized, indexMap } = normalizeHaystackWithIndexMap(haystack);
  const at = normalized.indexOf(needle);
  if (at < 0) {
    return null;
  }
  const last = at + needle.length - 1;
  const origStart = indexMap[at]!;
  const origEndInclusive = indexMap[last]!;
  return {
    index: origStart,
    length: origEndInclusive - origStart + 1,
  };
}

/**
 * 在源文件中匹配 originalText（H5）：
 * 有有效宽松行列 → 窗口内 → 扩大一次 → 全文；无行列 → 直接全文。
 * needle 保留换行（H12）。返回全文下标供预览映射。
 */
export function findAnnotateOccurrenceInSource(
  sourceText: string,
  originalText: string,
  softRange?: AnnotateSoftRangeFields | null,
  options?: { readonly linePadding?: number },
): AnnotateSourceMatch | null {
  if (!originalText || !normalizeAnnotateNeedle(originalText)) {
    return null;
  }

  const trySlice = (
    range: AnnotateSoftSourceRange,
    strategy: AnnotateSourceMatchStrategy,
  ): AnnotateSourceMatch | null => {
    const { text, startOffset } = sliceSourceBySoftRange(sourceText, range);
    const hit = findFirstNormalizedInHaystack(text, originalText);
    if (hit == null) {
      return null;
    }
    return {
      index: startOffset + hit.index,
      length: hit.length,
      strategy,
    };
  };

  if (hasValidAnnotateSoftRange(softRange)) {
    const windowHit = trySlice(softRange, "window");
    if (windowHit != null) {
      return windowHit;
    }
    const expanded = expandSoftRangeOnce(softRange, sourceText, options);
    if (
      expanded.startLine !== softRange.startLine ||
      expanded.endLine !== softRange.endLine
    ) {
      const expandedHit = trySlice(expanded, "expanded");
      if (expandedHit != null) {
        return expandedHit;
      }
    }
  }

  const full = findFirstNormalizedInHaystack(sourceText, originalText);
  if (full == null) {
    return null;
  }
  return { index: full.index, length: full.length, strategy: "full" };
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
 * **切断合同**：调用方须在 block / `br` / `TABLE` 边界处切断，
 * 仅将同一匹配域内的 Text segments 传入本函数（彼此直拼、无插入符）。
 * 表内相邻格允许直拼；跨 `<p>` / 跨表不得并入同一 `segments` 列表，否则会误命中。
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
