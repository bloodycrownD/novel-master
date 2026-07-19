/**
 * 批注下划线：按 originalText 在 .doc-body 内尽力匹配高亮；重复片段全部高亮。
 */

export type AnnotateMark = {
  readonly id: string;
  readonly originalText: string;
};

const MARK_CLASS = 'annotate-mark';

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

/** 解开已有 mark，恢复纯文本节点。 */
export function unwrapAnnotateMarks(root: ParentNode): void {
  const marks = root.querySelectorAll?.(`.${MARK_CLASS}`);
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
 * 在 root 内为每条批注包裹全部原文匹配。
 * 同 path 多条、原文重复时：各条分别匹配；重叠处后写可能跳过已 mark 内文本。
 */
export function applyAnnotateMarks(
  root: ParentNode,
  annotations: readonly AnnotateMark[],
): void {
  unwrapAnnotateMarks(root);
  for (const ann of annotations) {
    const text = ann.originalText;
    if (!text || !ann.id) {
      continue;
    }
    wrapAllPlainMatches(root, text, ann.id);
  }
}

function wrapAllPlainMatches(
  root: ParentNode,
  needle: string,
  id: string,
): void {
  // 反复查找直至无更多未包装匹配（每次 wrap 会改 DOM）
  let guard = 0;
  while (guard++ < 200) {
    const hit = findFirstUnmarkedPlainMatch(root, needle);
    if (!hit) {
      break;
    }
    wrapRange(hit.node, hit.start, hit.end, id);
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
  const doc = root.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
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
      (cur as Element).classList?.contains(MARK_CLASS)
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
  id: string,
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
  mark.className = MARK_CLASS;
  mark.setAttribute('data-annotate-id', id);
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
