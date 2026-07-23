/**
 * 批注下划线：按 originalText 在 .doc-body 内尽力匹配高亮；重复片段全部高亮。
 * 纯算法在 `@novel-master/core/chat`；本文件保留 DOM collect / wrap 壳。
 * 定稿 apply（D5）：unwrap → 长优先 → 收集未 mark Text（D1 分批）→ flat findAll → 多段 wrap。
 */

import {
  buildFlatTextIndex,
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  mapFlatRangeToSegments,
  normalizeAnnotateNeedle,
  sortAnnotateTextsLongestFirst,
} from '@novel-master/core/chat';

export type AnnotateMark = {
  readonly id: string;
  readonly originalText: string;
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
 * 在 root 内按原文匹配包裹下划线。
 * 同文多 id 挂同一 mark；先长后短，减少重叠丢失。
 * 跨行内节点可拆成多段连续 mark（同 ids）。
 */
export function applyAnnotateMarks(
  root: ParentNode,
  annotations: readonly AnnotateMark[],
): void {
  unwrapAnnotateMarks(root);
  const byText = groupAnnotateIdsByOriginalText(annotations);
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

/**
 * 一次收集未 mark 的 Text（按 D1 分批）→ flat 全量命中 → 右到左多段 wrap。
 * 废弃 while + 200×findFirst 模型。
 */
function wrapAllPlainMatchesFlat(
  root: ParentNode,
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
