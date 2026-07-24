/**
 * 划词采集：相对 .doc-body 可见文本的半开 offset / 邻域。
 * 使用 Range.toString()，不计 HTML 标签字符（认锚 DOM 下仍对齐无锚 VFS 正文坐标系，Step 5a）。
 */
import { post } from './post';

export type AnnotateCollectMode = 'plain' | 'markdown';

export type AnnotateSelectionCollectPayload = {
  readonly originalText: string;
  readonly mode: AnnotateCollectMode;
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
};

const CONTEXT_CHARS = 64;

/**
 * 选区在 element 文本内容中的 0-based 半开偏移（与 Desktop getSelectionOffsetsInElement 同构）。
 */
export function getSelectionOffsetsInElement(
  element: Element,
  selection: Selection | null | undefined =
    typeof window !== 'undefined' ? window.getSelection() : null,
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

/** 采集当前选区；失败时仍尽量回传 originalText。 */
export function collectAnnotateSelection(
  mode: AnnotateCollectMode,
): AnnotateSelectionCollectPayload | null {
  const sel =
    typeof window !== 'undefined' ? window.getSelection() : null;
  const raw = (sel?.toString() ?? '').replace(/\u00a0/g, ' ');
  const originalText = raw.trim();
  if (!originalText) {
    return null;
  }

  const body = document.querySelector('.doc-body');
  if (!body) {
    return { originalText, mode };
  }

  const offsets = getSelectionOffsetsInElement(body, sel);
  if (mode === 'plain') {
    if (offsets == null) {
      return { originalText, mode };
    }
    return {
      originalText,
      mode,
      selectionStart: offsets.start,
      selectionEnd: offsets.end,
    };
  }

  // markdown：邻域取自可见正文（非 VFS 源字面量）；Core 再用邻域在无锚全文定位
  const full = body.textContent ?? '';
  if (offsets == null) {
    return { originalText, mode };
  }
  const contextBefore = full.slice(
    Math.max(0, offsets.start - CONTEXT_CHARS),
    offsets.start,
  );
  const contextAfter = full.slice(
    offsets.end,
    Math.min(full.length, offsets.end + CONTEXT_CHARS),
  );
  return {
    originalText,
    mode,
    contextBefore,
    contextAfter,
  };
}

/** 供 RN injectJavaScript 调用：采集后 postMessage selectionCollect。 */
export function reportAnnotateSelectionCollect(mode: AnnotateCollectMode): void {
  const payload = collectAnnotateSelection(mode);
  if (payload == null) {
    return;
  }
  post('selectionCollect', {...payload});
}

declare global {
  interface Window {
    __nmCollectAnnotateSelection?: (mode: string) => void;
  }
}

/** 挂到 window，供 RichDocumentWebView.injectJavaScript 触发。 */
export function bindAnnotateCollectBridge(): void {
  window.__nmCollectAnnotateSelection = (mode: string) => {
    const m: AnnotateCollectMode =
      mode === 'plain' ? 'plain' : 'markdown';
    reportAnnotateSelectionCollect(m);
  };
}
