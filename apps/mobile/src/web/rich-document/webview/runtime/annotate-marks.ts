/**
 * 批注下划线：按 originalText 在 .doc-body 内尽力匹配高亮；重复片段全部高亮。
 * 同文多条批注共用一处 mark（data-annotate-ids）；长 needle 优先以免短串抢占。
 */

export type AnnotateMark = {
  readonly id: string;
  readonly originalText: string;
};

export const ANNOTATE_MARK_CLASS = 'annotate-mark';
export const ANNOTATE_IDS_ATTR = 'data-annotate-ids';

/** 非重叠查找 needle 在 haystack 中的全部起始下标（供单测）。 */
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

/** 按 originalText 聚合 draft id（同文多条共用一处下划线点击）。 */
export function groupAnnotateIdsByOriginalText(
  drafts: readonly {readonly id: string; readonly originalText: string}[],
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
  if (raw == null || raw === '') {
    return [];
  }
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 应用顺序：originalText 长度降序（长优先），重叠/嵌套时避免短针抢占。
 * 供单测断言。
 */
export function sortAnnotateTextsLongestFirst(
  texts: readonly string[],
): string[] {
  return [...texts].sort((a, b) => b.length - a.length);
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
 * 在 root 内按原文匹配包裹下划线。
 * 同文多 id 挂同一 mark；先长后短，减少重叠丢失。
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
    wrapAllPlainMatches(root, text, ids);
  }
}

function wrapAllPlainMatches(
  root: ParentNode,
  needle: string,
  ids: readonly string[],
): void {
  // 反复查找直至无更多未包装匹配（每次 wrap 会改 DOM）
  let guard = 0;
  while (guard++ < 200) {
    const hit = findFirstUnmarkedPlainMatch(root, needle);
    if (!hit) {
      break;
    }
    wrapRange(hit.node, hit.start, hit.end, ids);
  }
}

type PlainHit = {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
};

function findFirstUnmarkedPlainMatch(
  root: ParentNode,
  needle: string,
): PlainHit | null {
  const doc =
    root.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createTreeWalker !== 'function') {
    return null;
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (!isInsideAnnotateMark(textNode)) {
      const value = textNode.nodeValue ?? '';
      const at = value.indexOf(needle);
      if (at >= 0) {
        return {
          node: textNode,
          start: at,
          end: at + needle.length,
        };
      }
    }
    node = walker.nextNode();
  }
  return null;
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

function wrapRange(
  textNode: Text,
  start: number,
  end: number,
  ids: readonly string[],
): void {
  const doc = textNode.ownerDocument;
  if (!doc) {
    return;
  }
  const value = textNode.nodeValue ?? '';
  const before = value.slice(0, start);
  const mid = value.slice(start, end);
  const after = value.slice(end);
  const mark = doc.createElement('mark');
  mark.className = ANNOTATE_MARK_CLASS;
  mark.setAttribute(ANNOTATE_IDS_ATTR, ids.join(','));
  mark.textContent = mid;

  const parent = textNode.parentNode;
  if (!parent) {
    return;
  }
  if (before) {
    parent.insertBefore(doc.createTextNode(before), textNode);
  }
  parent.insertBefore(mark, textNode);
  if (after) {
    textNode.nodeValue = after;
  } else {
    parent.removeChild(textNode);
  }
}
