/**
 * Desktop PreviewPane 划词批注：入口门闩 + 选区 + 原文匹配下划线（尽力）。
 * 纯算法在 `@shared/logic/chat`；本文件保留 DOM collect / wrap 壳。
 * 定稿 apply（D5）：clear → 长优先 → 收集未 mark Text（D1 分批）→ flat findAll → 多段 wrap。
 * 仅 mode==="read" 且 workspaceScope==="chat" 且非空 sessionId 启用。
 */

import {
  buildFlatTextIndex,
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  sortAnnotateTextsLongestFirst,
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

/** 切断匹配域：block / br / 表单元格（D1）。 */
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
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

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

/** 清除 container 内批注下划线 mark，还原文本节点。 */
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
}

/**
 * 按 originalText 在预览 DOM 内做原文匹配下划线（尽力；重复则全部匹配）。
 * 跨行内节点拆成多段连续 mark（同 ids）；跨 block/br/单元格不误拼。
 */
export function applyAnnotateHighlights(
  root: HTMLElement,
  drafts: readonly { readonly id: string; readonly originalText: string }[],
): void {
  clearAnnotateHighlights(root);
  const byText = groupAnnotateIdsByOriginalText(drafts);
  const texts = sortAnnotateTextsLongestFirst([...byText.keys()]);
  for (const text of texts) {
    const ids = byText.get(text);
    if (ids == null || ids.length === 0) {
      continue;
    }
    const needle = normalizeAnnotateNeedle(text);
    if (!needle) {
      continue;
    }
    wrapAllPlainMatchesFlat(root, needle, ids);
  }
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
 * 按文档序收集未处于 preview-annotate-mark 内的 Text，并在 block/br/td 边界分批（D1a）。
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
      if (!isInsideAnnotateMark(textNode)) {
        current.push(textNode);
      }
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const el = node as Element;
    if (el.classList?.contains(PREVIEW_ANNOTATE_MARK_CLASS)) {
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
