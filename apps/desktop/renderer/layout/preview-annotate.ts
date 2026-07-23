/**
 * Desktop PreviewPane 划词批注：入口门闩 + 选区 + 原文匹配高亮。
 * 主路径 CSS Custom Highlight（H1/H2）；不支持时 mark 回退（H3）。
 * 纯算法在 `@shared/logic/chat`；本文件保留 DOM collect / Range / wrap 壳。
 * 仅 mode==="read" 且 workspaceScope==="chat" 且非空 sessionId 启用。
 */

import {
  buildFlatTextIndex,
  estimateSoftRangeFromOriginalText,
  estimateSoftRangeFromPlainOffsets,
  findAllOccurrences,
  findAnnotateOccurrenceInSource,
  groupAnnotateIdsByOriginalText,
  hasValidAnnotateSoftRange,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
  type AnnotateSoftSourceRange,
} from "@shared/logic/chat";
import type { WorkspacePanelScope } from "@shared/ipc-types";

export {
  buildFlatTextIndex,
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
} from "@shared/logic/chat";

export const PREVIEW_ANNOTATE_MARK_CLASS = "preview-annotate-mark";
export const PREVIEW_ANNOTATE_IDS_ATTR = "data-annotate-ids";
/** CSS Custom Highlight 注册名（::highlight(nm-annotate)）。 */
export const PREVIEW_ANNOTATE_HIGHLIGHT_NAME = "nm-annotate";

/** 切断匹配域：block / br / TABLE（表内相邻 Text 直拼；表与前后段落切断，T1/T6）。 */
const CUT_BOUNDARY_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "DD",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

/** 已注册 Custom Highlight 条目（供点击 hit-test）。 */
type ActiveHighlightEntry = {
  readonly range: Range;
  readonly ids: readonly string[];
};

let activeHighlightEntries: ActiveHighlightEntry[] = [];

/** 划词批注入口门闩（编辑态 / global / session / 无 sessionId 均无入口）。 */
export function isPreviewAnnotateEnabled(
  mode: "read" | "edit",
  workspaceScope: WorkspacePanelScope | null | undefined,
  sessionId?: string | null,
): boolean {
  return (
    mode === "read" &&
    workspaceScope === "chat" &&
    typeof sessionId === "string" &&
    sessionId.length > 0
  );
}

/**
 * H1：是否支持 CSS Custom Highlight。
 * `typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function'`
 */
export function supportsCssCustomHighlight(
  globalObj: typeof globalThis = globalThis,
): boolean {
  const g = globalObj as typeof globalThis & {
    CSS?: { highlights?: unknown };
    Highlight?: unknown;
  };
  return (
    typeof g.CSS !== "undefined" &&
    g.CSS != null &&
    !!g.CSS.highlights &&
    typeof g.Highlight === "function"
  );
}

/**
 * 若选区落在 container 内且非空，返回规范化纯文本；否则 null。
 * 供 PreviewPane 在 mouseup / selectionchange 时调用。
 */
export function readSelectionTextInContainer(
  container: ParentNode | null | undefined,
  selection: Selection | null | undefined = typeof window !== "undefined"
    ? window.getSelection()
    : null,
): string | null {
  if (container == null || selection == null || selection.rangeCount === 0) {
    return null;
  }
  if (selection.isCollapsed) {
    return null;
  }
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (anchor == null || focus == null) {
    return null;
  }
  if (!container.contains(anchor) || !container.contains(focus)) {
    return null;
  }
  const text = selection.toString().replace(/\u00a0/g, " ");
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 选区相对视口的浮动条锚点（选区上方居中；无选区则 null）。 */
export function getSelectionFloatingAnchor(
  selection: Selection | null | undefined = typeof window !== "undefined"
    ? window.getSelection()
    : null,
): { readonly top: number; readonly left: number } | null {
  if (selection == null || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return {
    top: Math.max(8, rect.top - 8),
    left: rect.left + rect.width / 2,
  };
}

/**
 * 选区在 element 文本内容中的 0-based 半开偏移（plain/`pre` 用）。
 * 选区须落在 element 内。
 */
export function getSelectionOffsetsInElement(
  element: HTMLElement,
  selection: Selection | null | undefined = typeof window !== "undefined"
    ? window.getSelection()
    : null,
): { readonly start: number; readonly end: number } | null {
  if (selection == null || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const selRange = selection.getRangeAt(0);
  if (
    !element.contains(selRange.startContainer) ||
    !element.contains(selRange.endContainer)
  ) {
    return null;
  }
  const doc = element.ownerDocument;
  if (doc == null) {
    return null;
  }
  const preRange = doc.createRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(selRange.startContainer, selRange.startOffset);
  const start = preRange.toString().length;
  const selectedLen = selRange.toString().length;
  return { start, end: start + selectedLen };
}

/**
 * 预览选区 → 源文件宽松行列（H6/H7）。
 * plain：选区偏移换算；MD / 无偏移：原文定位 + padding。
 */
export function estimateSoftRangeForPreviewSelection(args: {
  readonly sourceText: string;
  readonly isPlainPreview: boolean;
  readonly selectedText: string;
  readonly selection?: Selection | null;
  readonly plainRoot?: HTMLElement | null;
}): AnnotateSoftSourceRange | null {
  const { sourceText, isPlainPreview, selectedText } = args;
  if (!sourceText || !selectedText) {
    return null;
  }
  if (isPlainPreview && args.plainRoot != null) {
    const offsets = getSelectionOffsetsInElement(
      args.plainRoot,
      args.selection,
    );
    if (offsets != null) {
      return estimateSoftRangeFromPlainOffsets(
        sourceText,
        offsets.start,
        offsets.end,
      );
    }
  }
  return estimateSoftRangeFromOriginalText(sourceText, selectedText);
}

/** 当前已注册的 Custom Highlight 条目（测试 / 点击）。 */
export function getActiveAnnotateHighlightEntries(): readonly ActiveHighlightEntry[] {
  return activeHighlightEntries;
}

/** 清除 container 内批注 mark，并清空 Custom Highlight 注册。 */
export function clearAnnotateHighlights(root: HTMLElement): void {
  const marks = [
    ...root.querySelectorAll(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`),
  ];
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent == null) {
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
  clearCssAnnotateHighlight();
}

function clearCssAnnotateHighlight(): void {
  activeHighlightEntries = [];
  try {
    const highlights = (
      globalThis as typeof globalThis & {
        CSS?: { highlights?: { delete?: (name: string) => void } };
      }
    ).CSS?.highlights;
    highlights?.delete?.(PREVIEW_ANNOTATE_HIGHLIGHT_NAME);
  } catch {
    // 忽略宿主差异
  }
}

/** apply 入参草稿（含 optional 宽松行列）。 */
export type PreviewAnnotateDraftInput = {
  readonly id: string;
  readonly originalText: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly startCol?: number;
  readonly endCol?: number;
};

/**
 * 按 originalText 在预览 DOM 内匹配并绘制高亮（H11：文本/MD 同入口）。
 * 有 sourceText 时先走 findAnnotateOccurrenceInSource（窗口优先，H5）；
 * 支持 Custom Highlight 则注册 Range，否则 mark 回退。
 */
export function applyAnnotateHighlights(
  root: HTMLElement,
  drafts: readonly PreviewAnnotateDraftInput[],
  options?: { readonly sourceText?: string },
): void {
  clearAnnotateHighlights(root);
  const byText = groupAnnotateIdsByOriginalText(drafts);
  const texts = sortAnnotateTextsLongestFirst([...byText.keys()]);
  const useHighlight = supportsCssCustomHighlight();
  const highlightEntries: ActiveHighlightEntry[] = [];

  for (const text of texts) {
    const ids = byText.get(text);
    if (ids == null || ids.length === 0) {
      continue;
    }
    const needle = normalizeAnnotateNeedle(text);
    if (!needle) {
      continue;
    }

    if (options?.sourceText != null) {
      const softDraft = drafts.find(
        (d) => d.originalText === text && hasValidAnnotateSoftRange(d),
      );
      const sourceHit = findAnnotateOccurrenceInSource(
        options.sourceText,
        text,
        softDraft ?? null,
      );
      if (sourceHit == null) {
        continue;
      }
    }

    if (useHighlight) {
      const ranges = collectMatchDomRanges(root, needle);
      for (const range of ranges) {
        if (highlightEntries.some((e) => rangesIntersect(e.range, range))) {
          continue;
        }
        highlightEntries.push({ range, ids });
      }
    } else {
      wrapAllPlainMatchesFlat(root, needle, ids);
    }
  }

  if (useHighlight && highlightEntries.length > 0) {
    registerCssAnnotateHighlight(highlightEntries);
  }
}

function registerCssAnnotateHighlight(
  entries: readonly ActiveHighlightEntry[],
): void {
  activeHighlightEntries = [...entries];
  const HighlightCtor = (
    globalThis as typeof globalThis & {
      Highlight: new (...ranges: Range[]) => unknown;
    }
  ).Highlight;
  const highlight = new HighlightCtor(...entries.map((e) => e.range));
  const highlights = (
    globalThis as typeof globalThis & {
      CSS: { highlights: { set: (name: string, value: unknown) => void } };
    }
  ).CSS.highlights;
  highlights.set(PREVIEW_ANNOTATE_HIGHLIGHT_NAME, highlight);
}

/** 两 Range 是否相交（含边界触碰视为相交，用于长优先去重）。 */
function rangesIntersect(a: Range, b: Range): boolean {
  try {
    return (
      a.compareBoundaryPoints(Range.END_TO_START, b) < 0 &&
      a.compareBoundaryPoints(Range.START_TO_END, b) > 0
    );
  } catch {
    return false;
  }
}

/**
 * 点击命中批注 id（H4）：Highlight hit-test → caret 与已注册 Range 求交 → closest(mark)。
 */
export function resolveAnnotateIdsFromClick(
  root: HTMLElement,
  event: {
    readonly clientX: number;
    readonly clientY: number;
    readonly target: EventTarget | null;
  },
): string[] {
  const fromHighlight = resolveIdsFromHighlightHitTest(
    root,
    event.clientX,
    event.clientY,
  );
  if (fromHighlight.length > 0) {
    return fromHighlight;
  }

  const target = event.target;
  if (isDomElement(target)) {
    const mark = target.closest(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`);
    if (mark != null && root.contains(mark)) {
      return parseAnnotateIdsAttr(
        mark.getAttribute(PREVIEW_ANNOTATE_IDS_ATTR),
      );
    }
  }
  return [];
}

/** Node 环境无全局 Element 时仍可识别 DOM 元素。 */
function isDomElement(node: EventTarget | null): node is Element {
  return (
    node != null &&
    typeof node === "object" &&
    "nodeType" in node &&
    (node as Node).nodeType === 1 &&
    "closest" in node &&
    typeof (node as Element).closest === "function"
  );
}

function resolveIdsFromHighlightHitTest(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): string[] {
  if (activeHighlightEntries.length === 0) {
    return [];
  }

  const highlights = (
    globalThis as typeof globalThis & {
      CSS?: {
        highlights?: {
          highlightsFromPoint?: (
            x: number,
            y: number,
          ) => Iterable<unknown> | unknown[] | null | undefined;
        };
      };
    }
  ).CSS?.highlights;

  if (typeof highlights?.highlightsFromPoint === "function") {
    try {
      const hits = highlights.highlightsFromPoint(clientX, clientY);
      if (hits != null) {
        for (const hit of hits as Iterable<unknown>) {
          const name =
            typeof hit === "string"
              ? hit
              : hit != null &&
                  typeof hit === "object" &&
                  "name" in hit &&
                  typeof (hit as { name: unknown }).name === "string"
                ? (hit as { name: string }).name
                : null;
          if (name === PREVIEW_ANNOTATE_HIGHLIGHT_NAME) {
            // 点在命名高亮上：再按 caret 细分到具体 Range/ids
            break;
          }
        }
      }
    } catch {
      // 继续 caret 回退
    }
  }

  const doc = root.ownerDocument;
  if (doc == null) {
    return [];
  }

  let caret: Range | null = null;
  const docWithCaret = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof docWithCaret.caretRangeFromPoint === "function") {
    caret = docWithCaret.caretRangeFromPoint(clientX, clientY);
  } else if (typeof docWithCaret.caretPositionFromPoint === "function") {
    const pos = docWithCaret.caretPositionFromPoint(clientX, clientY);
    if (pos?.offsetNode != null) {
      caret = doc.createRange();
      caret.setStart(pos.offsetNode, pos.offset);
      caret.collapse(true);
    }
  }

  if (caret != null) {
    if (!root.contains(caret.startContainer)) {
      return [];
    }
    for (const entry of activeHighlightEntries) {
      try {
        if (
          entry.range.isPointInRange(caret.startContainer, caret.startOffset)
        ) {
          return [...entry.ids];
        }
      } catch {
        // 边界点在部分宿主会抛；忽略
      }
    }
  }

  return [];
}

/** 一次收集 → flat 全量命中 → 各 Text 局部 DOM Range（不改 DOM；H2 允许多 Range）。 */
function collectMatchDomRanges(root: HTMLElement, needle: string): Range[] {
  const out: Range[] = [];
  const domains = collectUnmarkedTextDomains(root);
  for (const domainNodes of domains) {
    if (domainNodes.length === 0) {
      continue;
    }
    const segments = domainNodes.map((n) => n.nodeValue ?? "");
    const index = buildFlatTextIndex(segments);
    const hits = findAllOccurrences(index.haystack, needle);
    for (const at of hits) {
      const locals = mapFlatRangeToSegments(at, at + needle.length, index);
      for (const local of locals) {
        const node = domainNodes[local.segmentIndex];
        if (node == null) {
          continue;
        }
        const range = createCharRange(node, local.start, local.end);
        if (range != null) {
          out.push(range);
        }
      }
    }
  }
  return out;
}

/**
 * 在 Text 上创建 [start,end) 的 Range。
 * 真实浏览器用 setStart/setEnd；linkedom 等缺省实现则用可 toString 的替身（供单测注册 Highlight）。
 */
function createCharRange(
  node: Text,
  start: number,
  end: number,
): Range | null {
  const value = node.nodeValue ?? "";
  if (start < 0 || end > value.length || start >= end) {
    return null;
  }
  const doc = node.ownerDocument;
  if (doc == null) {
    return null;
  }
  const range = doc.createRange();
  if (typeof range.setStart === "function" && typeof range.setEnd === "function") {
    try {
      range.setStart(node, start);
      range.setEnd(node, end);
      return range;
    } catch {
      return null;
    }
  }
  const sliced = value.slice(start, end);
  const stub = {
    startContainer: node,
    startOffset: start,
    endContainer: node,
    endOffset: end,
    collapsed: false,
    commonAncestorContainer: node.parentNode ?? node,
    toString: () => sliced,
    isPointInRange(n: Node, o: number) {
      return n === node && o >= start && o < end;
    },
    compareBoundaryPoints: () => 0,
    cloneRange() {
      return stub as unknown as Range;
    },
    setStart() {},
    setEnd() {},
  };
  return stub as unknown as Range;
}

/** 一次收集 → flat 全量命中 → 右到左多段 wrap（废弃单 Text / findFirst×N）。 */
function wrapAllPlainMatchesFlat(
  root: HTMLElement,
  needle: string,
  ids: readonly string[],
): void {
  const domains = collectUnmarkedTextDomains(root);
  for (const domain of domains) {
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
  const segments = domainNodes.map((n) => n.nodeValue ?? "");
  const index = buildFlatTextIndex(segments);
  const hits = findAllOccurrences(index.haystack, needle);
  if (hits.length === 0) {
    return;
  }
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
      nodes[range.segmentIndex] = beforeNode;
    }
  }
}

/**
 * 按文档序收集未处于 preview-annotate-mark 内的 Text，并在 block/br/TABLE 边界分批（T1/T6）。
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
    if (el.classList?.contains(PREVIEW_ANNOTATE_MARK_CLASS)) {
      // 已包装区域整块跳过；先 flush，避免 mark 两侧 Text 拼进同一 haystack
      flush();
      return;
    }
    const tag = el.tagName?.toUpperCase?.() ?? "";
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
  const value = textNode.nodeValue ?? "";
  if (!/^[\t\n\r ]*$/.test(value)) {
    return false;
  }
  let cur: Node | null = textNode.parentNode;
  while (cur) {
    if (
      cur.nodeType === 1 &&
      (cur as Element).tagName?.toUpperCase?.() === "TABLE"
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
      (cur as Element).classList?.contains(PREVIEW_ANNOTATE_MARK_CLASS)
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
  const value = textNode.nodeValue ?? "";
  if (start < 0 || end > value.length || start >= end) {
    return null;
  }
  const before = value.slice(0, start);
  const mid = value.slice(start, end);
  const after = value.slice(end);
  const mark = doc.createElement("mark");
  mark.className = PREVIEW_ANNOTATE_MARK_CLASS;
  mark.setAttribute(PREVIEW_ANNOTATE_IDS_ATTR, ids.join(","));
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
