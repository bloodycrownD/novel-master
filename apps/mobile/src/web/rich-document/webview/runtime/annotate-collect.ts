/**
 * 划词采集：相对 .doc-body 可见文本的半开 offset / 邻域。
 * 生产新建批注只走 {@link reportRecogitoCreateFromSelection}（`__nmCollectRecogitoSelection`）。
 * {@link collectAnnotateSelection} 仅测用 / 工具层残留，不挂 window。
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
 * 选区在 element 文本内容中的 0-based 半开偏移（原始未 trim；与 Desktop 量测同构）。
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

/**
 * @deprecated 测用 / 工具层残留；MD 新建批注请用 {@link reportRecogitoCreateFromSelection}。
 * 采集当前选区；失败时仍尽量回传 originalText。
 */
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

/**
 * 供 RN「批注」菜单 injectJavaScript：量测 .doc-body 可见正文半开 offset，
 * 打 recogitoCreate（与 Recogito setAnnotations 同一坐标系）。
 *
 * 策略 (b)：quote 做 trim，并按 leading/trailing 空白收缩 renderStart/renderEnd，
 * 使容器正文 `slice(renderStart, renderEnd) === quote`（R4）。宿主勿二次 trim。
 */
export function reportRecogitoCreateFromSelection(): void {
  const sel =
    typeof window !== 'undefined' ? window.getSelection() : null;
  const rawSelected = sel?.toString() ?? '';
  const normalized = rawSelected.replace(/\u00a0/g, ' ');
  const quote = normalized.trim();
  if (!quote) {
    return;
  }
  const body = document.querySelector('.doc-body');
  if (body == null) {
    return;
  }
  const offsets = getSelectionOffsetsInElement(body, sel);
  if (offsets == null) {
    return;
  }
  const leadingWs = normalized.length - normalized.trimStart().length;
  const trailingWs = normalized.length - normalized.trimEnd().length;
  const renderStart = offsets.start + leadingWs;
  const renderEnd = offsets.end - trailingWs;
  if (renderStart >= renderEnd) {
    return;
  }
  post('recogitoCreate', {
    quote,
    renderStart,
    renderEnd,
  });
}

declare global {
  interface Window {
    /** 生产挂载：RN inject → recogitoCreate。 */
    __nmCollectRecogitoSelection?: () => void;
  }
}

/** 挂到 window，供 RichDocumentWebView.injectJavaScript 触发（仅 Recogito 采集）。 */
export function bindAnnotateCollectBridge(): void {
  window.__nmCollectRecogitoSelection = () => {
    reportRecogitoCreateFromSelection();
  };
}
