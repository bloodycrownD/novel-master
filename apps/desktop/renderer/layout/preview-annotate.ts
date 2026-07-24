/**
 * Desktop PreviewPane 划词批注：入口门闩 + 选区采集 + 锚点击。
 * 预览主路径：源 offset → buildAnnotatedSource 注入锚（PreviewPane）；
 * 本文件不再默认走 findAllOccurrences / applyAnnotateHighlights 搜字绘制。
 * 应急开关可临时恢复旧 DOM 搜字 apply（默认关）。
 * 仅 mode==="read" 且 workspaceScope==="chat" 且非空 sessionId 启用。
 */

import {
  ANNOTATE_ANCHOR_CLASS,
  buildFlatTextIndex,
  deriveSoftRangeFieldsFromOffsets,
  estimateSoftOffsetRangeFromPlainOffsets,
  estimateSoftOffsetRangeFromQuoteContext,
  findAllOccurrences,
  findAnnotateOccurrenceInSource,
  groupAnnotateIdsByOriginalText,
  hasValidAnnotateSoftRange,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  parseAnnotateIdsAttr,
  annotateOccurrenceOrdinal,
  selectAnnotateOccurrenceStarts,
  sortAnnotateTextsLongestFirst,
  type AnnotateSoftOffsetRange,
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
/** 锚点属性（A5 / A9）；与 Core `data-annotate-id` 一致。 */
export const PREVIEW_ANNOTATE_ID_ATTR = "data-annotate-id";
/** CSS Custom Highlight 注册名（::highlight(nm-annotate)；仅应急路径）。 */
export const PREVIEW_ANNOTATE_HIGHLIGHT_NAME = "nm-annotate";

/** MD 邻域默认半径（UTF-16 code unit；仅宿主 DOM 采集，定位走 Core）。 */
const MD_NEIGHBORHOOD_RADIUS = 64;

/**
 * 应急回滚：为 true 时 PreviewPane 可临时恢复旧 applyAnnotateHighlights。
 * 默认关；单测可用 {@link setPreviewAnnotateDomSearchFallbackForTests}。
 */
let previewAnnotateDomSearchFallback = false;

/** 是否启用旧 DOM 搜字高亮应急路径（默认 false）。 */
export function isPreviewAnnotateDomSearchFallbackEnabled(): boolean {
  return previewAnnotateDomSearchFallback;
}

/** 测试 / 应急开关：临时恢复旧搜字 apply。 */
export function setPreviewAnnotateDomSearchFallbackForTests(
  enabled: boolean,
): void {
  previewAnnotateDomSearchFallback = enabled;
}
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

/** 划词采集结果：权威为宽松半开 offset；行列由其派生。 */
export type PreviewAnnotateCollectResult = {
  /** 映射成功时非 null；失败走 A12，不写脏 offset。 */
  readonly softOffsetRange: AnnotateSoftOffsetRange | null;
  /** 由 softOffsetRange 派生；无 offset 时可为 null。 */
  readonly softRange: AnnotateSoftSourceRange | null;
};

/**
 * 预览选区 → 源文件宽松半开 offset（Step 5 / A10）。
 * plain：`getSelectionOffsetsInElement` → `estimateSoftOffsetRangeFromPlainOffsets`。
 * MD：宿主采邻域 → Core `estimateSoftOffsetRangeFromQuoteContext`（与 Mobile 同 API）。
 * 失败 → softOffsetRange=null（A12）。
 */
export function collectAnnotateRangeForPreviewSelection(args: {
  readonly sourceText: string;
  readonly isPlainPreview: boolean;
  readonly selectedText: string;
  readonly selection?: Selection | null;
  /** plain 量测根（如 pre.preview-text）；认锚后仍用 Range.toString 对齐无锚源串。 */
  readonly plainRoot?: HTMLElement | null;
  /** MD 邻域量测根（如 .preview-markdown）；缺省回退 plainRoot。 */
  readonly selectionRoot?: ParentNode | null;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}): PreviewAnnotateCollectResult {
  const { sourceText, isPlainPreview, selectedText } = args;
  if (!sourceText || !selectedText) {
    return { softOffsetRange: null, softRange: null };
  }

  let softOffsetRange: AnnotateSoftOffsetRange | null = null;

  if (isPlainPreview && args.plainRoot != null) {
    // plain 量测相对 VFS 无锚坐标系：认锚 DOM 的 Range.toString 不含标签字符
    const offsets = getSelectionOffsetsInElement(
      args.plainRoot,
      args.selection,
    );
    if (offsets != null && offsets.start < offsets.end) {
      softOffsetRange = estimateSoftOffsetRangeFromPlainOffsets(
        sourceText,
        offsets.start,
        offsets.end,
      );
    }
  } else {
    // Step 5b：宿主只采邻域；定位 + A10 padding 走 Core（与 Mobile 同链）
    const neighborhoodRoot = args.selectionRoot ?? args.plainRoot ?? null;
    const neighborhood =
      args.contextBefore != null || args.contextAfter != null
        ? {
            before: args.contextBefore ?? "",
            after: args.contextAfter ?? "",
          }
        : readSelectionNeighborhood(
            neighborhoodRoot,
            args.selection,
            MD_NEIGHBORHOOD_RADIUS,
          );
    softOffsetRange = estimateSoftOffsetRangeFromQuoteContext(sourceText, {
      originalText: selectedText,
      contextBefore: neighborhood?.before ?? "",
      contextAfter: neighborhood?.after ?? "",
    });
  }

  if (softOffsetRange == null) {
    return { softOffsetRange: null, softRange: null };
  }

  const softRange = deriveSoftRangeFieldsFromOffsets(
    sourceText,
    softOffsetRange.startOffset,
    softOffsetRange.endOffset,
  );
  return { softOffsetRange, softRange };
}

/**
 * @deprecated 请用 {@link collectAnnotateRangeForPreviewSelection}；保留给旧调用兼容。
 * 仅返回行列；不再写 offset 权威。
 */
export function estimateSoftRangeForPreviewSelection(args: {
  readonly sourceText: string;
  readonly isPlainPreview: boolean;
  readonly selectedText: string;
  readonly selection?: Selection | null;
  readonly plainRoot?: HTMLElement | null;
}): AnnotateSoftSourceRange | null {
  return collectAnnotateRangeForPreviewSelection(args).softRange;
}

/**
 * 读选区前后邻域纯文本（MD 采集用；相对当前选区容器 text）。
 * 邻域相对渲染 DOM，定位时再映射回 VFS 源串。
 */
export function readSelectionNeighborhood(
  container: ParentNode | null | undefined,
  selection: Selection | null | undefined = typeof window !== "undefined"
    ? window.getSelection()
    : null,
  radius: number = MD_NEIGHBORHOOD_RADIUS,
): { readonly before: string; readonly after: string } | null {
  if (container == null || selection == null || selection.rangeCount === 0) {
    return null;
  }
  if (selection.isCollapsed) {
    return null;
  }
  const selRange = selection.getRangeAt(0);
  if (
    !container.contains(selRange.startContainer) ||
    !container.contains(selRange.endContainer)
  ) {
    return null;
  }
  const doc = (container as Node).ownerDocument;
  if (doc == null) {
    return null;
  }
  const beforeRange = doc.createRange();
  beforeRange.selectNodeContents(container as Node);
  beforeRange.setEnd(selRange.startContainer, selRange.startOffset);
  const fullBefore = beforeRange.toString().replace(/\u00a0/g, " ");
  const afterRange = doc.createRange();
  afterRange.selectNodeContents(container as Node);
  afterRange.setStart(selRange.endContainer, selRange.endOffset);
  const fullAfter = afterRange.toString().replace(/\u00a0/g, " ");
  const pad = Math.max(0, Math.floor(radius));
  return {
    before: fullBefore.slice(Math.max(0, fullBefore.length - pad)),
    after: fullAfter.slice(0, pad),
  };
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
 * 【应急】按 originalText 在预览 DOM 内匹配并绘制高亮。
 * 预览主路径已退役（Step 6）；仅当 {@link isPreviewAnnotateDomSearchFallbackEnabled} 为真时由 PreviewPane 调用。
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

    let preferredOrdinal: number | null = null;
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
        if (!softDraft) {
          continue;
        }
        // 有软窗口但源 miss（MD 跨标记常见）：仍画 DOM，不按 ordinal 约束
      } else if (softDraft) {
        preferredOrdinal = annotateOccurrenceOrdinal(
          options.sourceText,
          text,
          sourceHit.index,
        );
      }
    }

    if (useHighlight) {
      const ranges = collectMatchDomRanges(root, needle, preferredOrdinal);
      for (const range of ranges) {
        if (highlightEntries.some((e) => rangesIntersect(e.range, range))) {
          continue;
        }
        highlightEntries.push({ range, ids });
      }
    } else {
      wrapAllPlainMatchesFlat(root, needle, ids, preferredOrdinal);
    }
  }

  if (useHighlight && highlightEntries.length > 0) {
    const ok = registerCssAnnotateHighlight(highlightEntries);
    if (!ok) {
      for (const text of texts) {
        const ids = byText.get(text);
        if (ids == null || ids.length === 0) {
          continue;
        }
        const needle = normalizeAnnotateNeedle(text);
        if (!needle) {
          continue;
        }
        let preferredOrdinal: number | null = null;
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
            if (!softDraft) {
              continue;
            }
          } else if (softDraft) {
            preferredOrdinal = annotateOccurrenceOrdinal(
              options.sourceText,
              text,
              sourceHit.index,
            );
          }
        }
        wrapAllPlainMatchesFlat(root, needle, ids, preferredOrdinal);
      }
    }
  }
}

function registerCssAnnotateHighlight(
  entries: readonly ActiveHighlightEntry[],
): boolean {
  try {
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
    return true;
  } catch {
    activeHighlightEntries = [];
    return false;
  }
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
 * 点击命中批注 id（A9）：优先 closest('[data-annotate-id]')；
 * 应急路径再走 Highlight hit-test / mark（旧 data-annotate-ids）。
 */
export function resolveAnnotateIdsFromClick(
  root: HTMLElement,
  event: {
    readonly clientX: number;
    readonly clientY: number;
    readonly target: EventTarget | null;
  },
): string[] {
  const target = event.target;
  if (isDomElement(target)) {
    const anchor = target.closest(
      `[${PREVIEW_ANNOTATE_ID_ATTR}], .${ANNOTATE_ANCHOR_CLASS}`,
    );
    if (anchor != null && root.contains(anchor)) {
      const id = anchor.getAttribute(PREVIEW_ANNOTATE_ID_ATTR);
      if (id != null && id.length > 0) {
        return [id];
      }
    }
  }

  if (!isPreviewAnnotateDomSearchFallbackEnabled()) {
    return [];
  }

  const fromHighlight = resolveIdsFromHighlightHitTest(
    root,
    event.clientX,
    event.clientY,
  );
  if (fromHighlight.length > 0) {
    return fromHighlight;
  }

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

  for (const entry of activeHighlightEntries) {
    let rects: DOMRectList | ArrayLike<DOMRect> | null = null;
    try {
      rects = entry.range.getClientRects?.() ?? null;
    } catch {
      rects = null;
    }
    if (!rects || rects.length === 0) {
      continue;
    }
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      if (
        clientX >= r.left &&
        clientX <= r.right &&
        clientY >= r.top &&
        clientY <= r.bottom
      ) {
        return [...entry.ids];
      }
    }
  }

  return [];
}

/** 一次收集 → flat 命中 → 各 Text 局部 DOM Range；有 preferred 时只取最近一处（H5）。 */
function collectMatchDomRanges(
  root: HTMLElement,
  needle: string,
  preferredOrdinal: number | null = null,
): Range[] {
  const out: Range[] = [];
  const domains = collectUnmarkedTextDomains(root);
  for (const domainNodes of domains) {
    if (domainNodes.length === 0) {
      continue;
    }
    const segments = domainNodes.map((n) => n.nodeValue ?? "");
    const index = buildFlatTextIndex(segments);
    const hits = selectAnnotateOccurrenceStarts(
      findAllOccurrences(index.haystack, needle),
      preferredOrdinal,
    );
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

/** 一次收集 → flat 命中 → 右到左多段 wrap；有 preferred 时只 wrap 最近一处（H5）。 */
function wrapAllPlainMatchesFlat(
  root: HTMLElement,
  needle: string,
  ids: readonly string[],
  preferredOrdinal: number | null = null,
): void {
  const domains = collectUnmarkedTextDomains(root);
  for (const domain of domains) {
    wrapOccurrencesInDomain(domain, needle, ids, preferredOrdinal);
  }
}

function wrapOccurrencesInDomain(
  domainNodes: Text[],
  needle: string,
  ids: readonly string[],
  preferredOrdinal: number | null,
): void {
  if (domainNodes.length === 0) {
    return;
  }
  const segments = domainNodes.map((n) => n.nodeValue ?? "");
  const index = buildFlatTextIndex(segments);
  const hits = selectAnnotateOccurrenceStarts(
    findAllOccurrences(index.haystack, needle),
    preferredOrdinal,
  );
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
