/**
 * Desktop PreviewPane 划词批注：入口门闩 + 选区 + 原文匹配下划线（尽力）。
 * 纯算法在 `@novel-master/core/chat`；本文件保留 DOM wrap 壳。
 * 仅 mode==="read" 且 workspaceScope==="chat" 且非空 sessionId 启用。
 */

import {
  groupAnnotateIdsByOriginalText,
  sortAnnotateTextsLongestFirst,
} from "@novel-master/core/chat";
import type { WorkspacePanelScope } from "@shared/ipc-types";

export {
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
} from "@novel-master/core/chat";

export const PREVIEW_ANNOTATE_MARK_CLASS = "preview-annotate-mark";
export const PREVIEW_ANNOTATE_IDS_ATTR = "data-annotate-ids";

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
 * 跨元素连续串无法匹配时跳过（条目仍保留）。
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
    wrapAllOccurrencesInRoot(root, text, ids);
  }
}

function wrapAllOccurrencesInRoot(
  root: HTMLElement,
  needle: string,
  ids: readonly string[],
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node != null) {
    const textNode = node as Text;
    const value = textNode.nodeValue ?? "";
    if (
      value.includes(needle) &&
      textNode.parentElement?.closest(`mark.${PREVIEW_ANNOTATE_MARK_CLASS}`) ==
        null
    ) {
      targets.push(textNode);
    }
    node = walker.nextNode();
  }

  const idsAttr = ids.join(",");
  for (const textNode of targets) {
    const value = textNode.nodeValue ?? "";
    let start = 0;
    let idx = value.indexOf(needle, start);
    if (idx === -1) {
      continue;
    }
    const frag = document.createDocumentFragment();
    while (idx !== -1) {
      if (idx > start) {
        frag.appendChild(document.createTextNode(value.slice(start, idx)));
      }
      const mark = document.createElement("mark");
      mark.className = PREVIEW_ANNOTATE_MARK_CLASS;
      mark.setAttribute(PREVIEW_ANNOTATE_IDS_ATTR, idsAttr);
      mark.textContent = needle;
      frag.appendChild(mark);
      start = idx + needle.length;
      idx = value.indexOf(needle, start);
    }
    if (start < value.length) {
      frag.appendChild(document.createTextNode(value.slice(start)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
