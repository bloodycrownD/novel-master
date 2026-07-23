/**
 * 批注下划线：按 originalText 在 .doc-body 内尽力匹配高亮；重复片段全部高亮。
 * 纯算法在 `@novel-master/core/chat`；本文件保留 DOM collect / wrap / Highlight 壳。
 * H1：探测 CSS Custom Highlight → 主路径 Range 注册；否则 mark 回退。
 * 定稿 apply：clear → 长优先 → 收集未 mark Text（D1 分批）→ flat findAll → Highlight 或多段 wrap。
 */

import {
  buildFlatTextIndex,
  findAllOccurrences,
  findAnnotateOccurrenceInSource,
  groupAnnotateIdsByOriginalText,
  hasValidAnnotateSoftRange,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  normalizeAnnotateNeedleStripNewlines,
  sortAnnotateTextsLongestFirst,
} from '@novel-master/core/chat';
import {
  ANNOTATE_HIGHLIGHT_NAME,
  ensureAnnotateHighlightCss,
} from './annotate-highlight-css';

export type AnnotateMark = {
  readonly id: string;
  readonly originalText: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly startCol?: number;
  readonly endCol?: number;
};

/** apply 可选：源文件文本（窗口匹配）与强制 mark 回退（测用）。 */
export type ApplyAnnotateOptions = {
  readonly sourceText?: string;
  readonly forceMarkFallback?: boolean;
  /** 探测用全局对象（默认 globalThis；测用可注入 mock）。 */
  readonly globalObj?: typeof globalThis;
};

export {
  buildFlatTextIndex,
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
} from '@novel-master/core/chat';

export const ANNOTATE_MARK_CLASS = 'annotate-mark';
export const ANNOTATE_IDS_ATTR = 'data-annotate-ids';

/** 切断匹配域：block / br / TABLE（表内相邻 Text 直拼；表与前后段落切断，T1/T6）。 */
const CUT_BOUNDARY_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BR',
  'DETAILS',
  'DIALOG',
  'DIV',
  'DL',
  'DT',
  'DD',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HGROUP',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
]);

/** Highlight 主路径已注册的 Range → draft ids（供点击命中）。 */
type RegisteredAnnotateRange = {
  readonly range: Range;
  readonly ids: readonly string[];
};

let registeredCssRanges: RegisteredAnnotateRange[] = [];

/**
 * H1：运行时探测 CSS Custom Highlight。
 * `typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function'`
 */
export function supportsCssCustomHighlight(
  globalObj: typeof globalThis = globalThis,
): boolean {
  const g = globalObj as {
    CSS?: {highlights?: unknown};
    Highlight?: unknown;
  };
  return (
    typeof g.CSS !== 'undefined' &&
    g.CSS != null &&
    g.CSS.highlights != null &&
    typeof g.Highlight === 'function'
  );
}

/** 清除命名 Highlight 与侧表（幂等）。 */
export function clearCssAnnotateHighlights(
  globalObj: typeof globalThis = globalThis,
): void {
  registeredCssRanges = [];
  const g = globalObj as {
    CSS?: {highlights?: {delete?: (name: string) => unknown}};
  };
  try {
    g.CSS?.highlights?.delete?.(ANNOTATE_HIGHLIGHT_NAME);
  } catch {
    // 忽略旧 WebView / 无 registry
  }
}

/** 当前 Highlight 侧表（测用 / 点击）。 */
export function getRegisteredCssAnnotateRanges(): readonly RegisteredAnnotateRange[] {
  return registeredCssRanges;
}

/**
 * H4：按点击坐标解析 draft ids。
 * 优先 highlightsFromPoint（若有）；否则 caretRangeFromPoint / caretPositionFromPoint 与已注册 Range 求交。
 * 失败返回 []，不抛。
 */
export function hitTestCssAnnotateIds(
  clientX: number,
  clientY: number,
  doc: Document = document,
  globalObj: typeof globalThis = globalThis,
): string[] {
  if (registeredCssRanges.length === 0) {
    return [];
  }

  const g = globalObj as {
    CSS?: {
      highlightsFromPoint?: (
        x: number,
        y: number,
      ) => Iterable<unknown> | unknown[] | null | undefined;
    };
  };
  try {
    const fromPoint = g.CSS?.highlightsFromPoint;
    if (typeof fromPoint === 'function') {
      const hits = fromPoint.call(g.CSS, clientX, clientY);
      if (hits != null) {
        for (const h of hits as Iterable<{name?: string}>) {
          if (h && (h as {name?: string}).name === ANNOTATE_HIGHLIGHT_NAME) {
            // 有命名命中时仍用 caret 解析具体 ids
            break;
          }
        }
      }
    }
  } catch {
    // 忽略
  }

  const caret = caretRangeAtPoint(doc, clientX, clientY);
  if (!caret) {
    return [];
  }
  for (const entry of registeredCssRanges) {
    if (rangeContainsCaret(entry.range, caret)) {
      return [...entry.ids];
    }
  }
  return [];
}

function caretRangeAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): Range | null {
  const d = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => {offsetNode: Node; offset: number} | null;
  };
  try {
    if (typeof d.caretRangeFromPoint === 'function') {
      return d.caretRangeFromPoint(clientX, clientY);
    }
  } catch {
    // 忽略
  }
  try {
    if (typeof d.caretPositionFromPoint === 'function') {
      const pos = d.caretPositionFromPoint(clientX, clientY);
      if (pos?.offsetNode != null && typeof pos.offset === 'number') {
        const range = doc.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
        return range;
      }
    }
  } catch {
    // 忽略
  }
  return null;
}

function rangeContainsCaret(annotateRange: Range, caret: Range): boolean {
  try {
    return (
      annotateRange.compareBoundaryPoints(Range.START_TO_START, caret) <= 0 &&
      annotateRange.compareBoundaryPoints(Range.END_TO_START, caret) > 0
    );
  } catch {
    return false;
  }
}

/** 解开已有 mark，恢复纯文本节点。 */
export function unwrapAnnotateMarks(root: ParentNode): void {
  const marks = root.querySelectorAll?.(`.${ANNOTATE_MARK_CLASS}`);
  if (!marks) {
    return;
  }
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (!mark || !mark.parentNode) {
      continue;
    }
    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
  // 合并相邻文本节点，便于再次匹配
  root.normalize?.();
}

/**
 * 在 root 内按原文匹配高亮（H1/H2/H3/H11）。
 * 支持 Highlight 时注册 Range；否则多段 mark（同 ids）。
 * 同文多 id 挂同一处；先长后短，减少重叠丢失。
 */
export function applyAnnotateMarks(
  root: ParentNode,
  annotations: readonly AnnotateMark[],
  options?: ApplyAnnotateOptions,
): void {
  const globalObj = options?.globalObj ?? globalThis;
  unwrapAnnotateMarks(root);
  clearCssAnnotateHighlights(globalObj);

  if (!annotations.length) {
    return;
  }

  const useHighlight =
    !options?.forceMarkFallback && supportsCssCustomHighlight(globalObj);

  if (useHighlight) {
    const doc =
      (root as Node).ownerDocument ??
      (typeof document !== 'undefined' ? document : null);
    if (doc) {
      ensureAnnotateHighlightCss(doc);
    }
  }

  const byText = groupAnnotateIdsByOriginalText(annotations);
  const texts = sortAnnotateTextsLongestFirst([...byText.keys()]);
  const pendingRanges: RegisteredAnnotateRange[] = [];
  /** Highlight 路径：长串已占用的节点区间，避免短针再叠（对齐 mark 抢占）。 */
  const coveredSpans: Array<{node: Text; start: number; end: number}> = [];

  for (const text of texts) {
    const ids = byText.get(text);
    if (ids == null || ids.length === 0) {
      continue;
    }
    if (!shouldApplyText(text, annotations, options?.sourceText)) {
      continue;
    }
    const needleForPlain = normalizeAnnotateNeedle(text);
    if (!needleForPlain) {
      continue;
    }
    if (useHighlight) {
      collectHighlightRangesForText(
        root,
        text,
        ids,
        pendingRanges,
        coveredSpans,
      );
    } else {
      wrapAllPlainMatchesFlat(root, text, ids);
    }
  }

  if (useHighlight && pendingRanges.length > 0) {
    registerCssHighlight(pendingRanges, globalObj);
  }
}

/**
 * 有有效宽松行列且提供源文件时：窗口/扩大/全文均未命中则跳过 DOM 绘制（H5）。
 * 无行列或无源文件 → 仍走 DOM 全文匹配（现网）。
 */
function shouldApplyText(
  text: string,
  annotations: readonly AnnotateMark[],
  sourceText: string | undefined,
): boolean {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return true;
  }
  const sample = annotations.find(
    a => a.originalText === text && a.id.length > 0,
  );
  if (!sample || !hasValidAnnotateSoftRange(sample)) {
    return true;
  }
  return findAnnotateOccurrenceInSource(sourceText, text, sample) != null;
}

function registerCssHighlight(
  entries: readonly RegisteredAnnotateRange[],
  globalObj: typeof globalThis,
): void {
  const g = globalObj as {
    Highlight: new (...ranges: AbstractRange[]) => {
      add?: (range: AbstractRange) => void;
    };
    CSS: {highlights: {set: (name: string, h: unknown) => void}};
  };
  try {
    const ranges = entries.map(e => e.range);
    const highlight =
      ranges.length > 0
        ? new g.Highlight(...ranges)
        : new g.Highlight();
    g.CSS.highlights.set(ANNOTATE_HIGHLIGHT_NAME, highlight);
    registeredCssRanges = [...entries];
  } catch {
    registeredCssRanges = [];
  }
}

/**
 * Highlight 路径：flat 命中后创建 DOM Range（不插 mark）。
 * 跨 strong 等多段 Range 同 ids（T-AR10）。
 */
function collectHighlightRangesForText(
  root: ParentNode,
  originalText: string,
  ids: readonly string[],
  out: RegisteredAnnotateRange[],
  coveredSpans: Array<{node: Text; start: number; end: number}>,
): void {
  const domains = collectUnmarkedTextDomains(root);
  for (const domain of domains) {
    const needle = needleForDomain(domain, originalText);
    if (!needle) {
      continue;
    }
    collectOccurrencesAsRanges(domain, needle, ids, out, coveredSpans);
  }
}

function needleForDomain(domainNodes: Text[], originalText: string): string {
  const inTable = domainIsInTable(domainNodes);
  return inTable
    ? normalizeAnnotateNeedleStripNewlines(originalText)
    : normalizeAnnotateNeedle(originalText);
}

function domainIsInTable(domainNodes: Text[]): boolean {
  for (const n of domainNodes) {
    let cur: Node | null = n.parentNode;
    while (cur) {
      if (
        cur.nodeType === 1 &&
        (cur as Element).tagName?.toUpperCase?.() === 'TABLE'
      ) {
        return true;
      }
      cur = cur.parentNode;
    }
  }
  return false;
}

function spanOverlapsCovered(
  coveredSpans: readonly {node: Text; start: number; end: number}[],
  node: Text,
  start: number,
  end: number,
): boolean {
  for (const c of coveredSpans) {
    if (c.node !== node) {
      continue;
    }
    if (!(end <= c.start || start >= c.end)) {
      return true;
    }
  }
  return false;
}

function collectOccurrencesAsRanges(
  domainNodes: Text[],
  needle: string,
  ids: readonly string[],
  out: RegisteredAnnotateRange[],
  coveredSpans: Array<{node: Text; start: number; end: number}>,
): void {
  if (domainNodes.length === 0 || !needle) {
    return;
  }
  const doc = domainNodes[0]?.ownerDocument;
  if (!doc || typeof doc.createRange !== 'function') {
    return;
  }
  const segments = domainNodes.map(n => n.nodeValue ?? '');
  const index = buildFlatTextIndex(segments);
  const hits = findAllOccurrences(index.haystack, needle);
  for (const at of hits) {
    const locals = mapFlatRangeToSegments(at, at + needle.length, index);
    let blocked = false;
    for (const local of locals) {
      const node = domainNodes[local.segmentIndex];
      if (node == null) {
        blocked = true;
        break;
      }
      if (spanOverlapsCovered(coveredSpans, node, local.start, local.end)) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      continue;
    }
    for (const local of locals) {
      const node = domainNodes[local.segmentIndex];
      if (node == null) {
        continue;
      }
      try {
        const range = doc.createRange();
        range.setStart(node, local.start);
        range.setEnd(node, local.end);
        out.push({range, ids});
        coveredSpans.push({node, start: local.start, end: local.end});
      } catch {
        // 忽略非法边界
      }
    }
  }
}

/**
 * 一次收集未 mark 的 Text（按 D1 分批）→ flat 全量命中 → 右到左多段 wrap。
 * 废弃 while + 200×findFirst 模型。
 */
function wrapAllPlainMatchesFlat(
  root: ParentNode,
  originalText: string,
  ids: readonly string[],
): void {
  const domains = collectUnmarkedTextDomains(root);
  for (const domain of domains) {
    const needle = needleForDomain(domain, originalText);
    if (!needle) {
      continue;
    }
    wrapOccurrencesInDomain(domain, needle, ids);
  }
}

function wrapOccurrencesInDomain(
  domainNodes: Text[],
  needle: string,
  ids: readonly string[],
): void {
  if (domainNodes.length === 0) {
    return;
  }
  const segments = domainNodes.map(n => n.nodeValue ?? '');
  const index = buildFlatTextIndex(segments);
  const hits = findAllOccurrences(index.haystack, needle);
  if (hits.length === 0) {
    return;
  }
  // 可变句柄：同节点右到左 wrap 后指向剩余左侧 Text
  const nodes: Array<Text | null> = domainNodes.slice();
  for (let hi = hits.length - 1; hi >= 0; hi--) {
    const at = hits[hi]!;
    const ranges = mapFlatRangeToSegments(at, at + needle.length, index);
    for (let ri = ranges.length - 1; ri >= 0; ri--) {
      const range = ranges[ri]!;
      const node = nodes[range.segmentIndex];
      if (node == null) {
        continue;
      }
      const beforeNode = wrapRange(node, range.start, range.end, ids);
      // 左侧区间仍落在 before；右侧 after 不再参与更早命中
      nodes[range.segmentIndex] = beforeNode;
    }
  }
}

/**
 * 按文档序收集未处于 annotate-mark 内的 Text，并在 block/br/TABLE 边界分批（T1/T6）。
 * TABLE 内纯空白 Text（pretty-print）不入域（T4）。
 */
function collectUnmarkedTextDomains(root: ParentNode): Text[][] {
  const domains: Text[][] = [];
  let current: Text[] = [];

  const flush = (): void => {
    if (current.length > 0) {
      domains.push(current);
      current = [];
    }
  };

  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const textNode = node as Text;
      if (
        !isInsideAnnotateMark(textNode) &&
        !isTableWhitespaceOnlyText(textNode)
      ) {
        current.push(textNode);
      }
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const el = node as Element;
    if (el.classList?.contains(ANNOTATE_MARK_CLASS)) {
      // 已包装区域整块跳过；先 flush，避免 mark 两侧 Text 拼进同一 haystack
      flush();
      return;
    }
    const tag = el.tagName?.toUpperCase?.() ?? '';
    const cut = CUT_BOUNDARY_TAGS.has(tag);
    if (cut) {
      flush();
    }
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      visit(children[i]!);
    }
    if (cut) {
      flush();
    }
  };

  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    visit(kids[i]!);
  }
  flush();
  return domains;
}

/** TABLE 祖先内且仅为 tab/换行/空格的 Text 不入匹配域（T4）。 */
function isTableWhitespaceOnlyText(textNode: Text): boolean {
  const value = textNode.nodeValue ?? '';
  if (!/^[\t\n\r ]*$/.test(value)) {
    return false;
  }
  let cur: Node | null = textNode.parentNode;
  while (cur) {
    if (
      cur.nodeType === 1 &&
      (cur as Element).tagName?.toUpperCase?.() === 'TABLE'
    ) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

function isInsideAnnotateMark(node: Node): boolean {
  let cur: Node | null = node.parentNode;
  while (cur) {
    if (
      cur.nodeType === 1 &&
      (cur as Element).classList?.contains(ANNOTATE_MARK_CLASS)
    ) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

/**
 * 将 textNode 的 [start,end) 包成 mark。
 * @returns 切出的左侧 Text（无 before 则为 null），供同节点右到左续包。
 */
function wrapRange(
  textNode: Text,
  start: number,
  end: number,
  ids: readonly string[],
): Text | null {
  const doc = textNode.ownerDocument;
  if (!doc) {
    return null;
  }
  const value = textNode.nodeValue ?? '';
  if (start < 0 || end > value.length || start >= end) {
    return null;
  }
  const before = value.slice(0, start);
  const mid = value.slice(start, end);
  const after = value.slice(end);
  const mark = doc.createElement('mark');
  mark.className = ANNOTATE_MARK_CLASS;
  mark.setAttribute(ANNOTATE_IDS_ATTR, ids.join(','));
  mark.textContent = mid;

  const parent = textNode.parentNode;
  if (!parent) {
    return null;
  }
  let beforeNode: Text | null = null;
  if (before) {
    beforeNode = doc.createTextNode(before);
    parent.insertBefore(beforeNode, textNode);
  }
  parent.insertBefore(mark, textNode);
  if (after) {
    textNode.nodeValue = after;
  } else {
    parent.removeChild(textNode);
  }
  return beforeNode;
}
