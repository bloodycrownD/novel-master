/**
 * rich-document 划词批注：锚点击打开；应急时可恢复旧 DOM 搜字 apply。
 * 「添加批注」由 RN WebView `menuItems` 提供（见 RichDocumentWebView）。
 * 主预览高亮来自 buildAnnotatedSource 注入的 `nm-annotate-anchor`，默认不再 applyAnnotateMarks。
 */
import { post } from './post';
import {
  ANNOTATE_IDS_ATTR,
  ANNOTATE_MARK_CLASS,
  applyAnnotateMarks,
  hitTestCssAnnotateIds,
  parseAnnotateIdsAttr,
  type AnnotateMark,
} from './annotate-marks';
import { ensureAnnotateHighlightCss } from './annotate-highlight-css';

/** 锚 class / 属性（与 Core ANNOTATE_ANCHOR_CLASS 对齐）。 */
export const ANNOTATE_ANCHOR_CLASS = 'nm-annotate-anchor';
export const ANNOTATE_ID_ATTR = 'data-annotate-id';

/**
 * 应急开关：临时恢复旧 setAnnotations → applyAnnotateMarks 搜字主路径。
 * 默认关；仅当 `globalThis.__NM_ANNOTATE_DOM_SEARCH_FALLBACK__ === true`。
 */
export function isAnnotateDomSearchFallbackEnabled(): boolean {
  try {
    return (
      (globalThis as { __NM_ANNOTATE_DOM_SEARCH_FALLBACK__?: unknown })
        .__NM_ANNOTATE_DOM_SEARCH_FALLBACK__ === true
    );
  } catch {
    return false;
  }
}

let annotateEnabled = false;
let annotations: AnnotateMark[] = [];
let sourceText = '';
let clickListenerBound = false;

export function setAnnotateEnabled(enabled: boolean): void {
  annotateEnabled = enabled === true;
  if (!annotateEnabled) {
    clearSelectionQuiet();
  }
  refreshAnnotateMarks();
}

export function setAnnotations(
  next: readonly AnnotateMark[],
  nextSourceText?: string,
): void {
  annotations = Array.isArray(next)
    ? next.map(a => ({
        id: String(a.id ?? ''),
        originalText: String(a.originalText ?? ''),
        ...(typeof a.startLine === 'number' ? { startLine: a.startLine } : {}),
        ...(typeof a.endLine === 'number' ? { endLine: a.endLine } : {}),
        ...(typeof a.startCol === 'number' ? { startCol: a.startCol } : {}),
        ...(typeof a.endCol === 'number' ? { endCol: a.endCol } : {}),
      }))
    : [];
  if (typeof nextSourceText === 'string') {
    sourceText = nextSourceText;
  }
  refreshAnnotateMarks();
}

/** 单独更新源文件文本（与 setAnnotations 拆开投递时用）。 */
export function setAnnotateSourceText(next: string): void {
  sourceText = typeof next === 'string' ? next : '';
  refreshAnnotateMarks();
}

/**
 * setDocument 渲染后：仅应急开关下重建旧 marks。
 * 默认主路径高亮已由宿主注入锚完成，禁止再搜字 apply。
 */
export function refreshAnnotateMarks(): void {
  if (!isAnnotateDomSearchFallbackEnabled()) {
    return;
  }
  const body = document.querySelector('.doc-body');
  if (!body) {
    return;
  }
  if (!annotateEnabled || annotations.length === 0) {
    applyAnnotateMarks(body, []);
    return;
  }
  applyAnnotateMarks(body, annotations, {
    sourceText: sourceText.length > 0 ? sourceText : undefined,
    // Mobile WebView ::highlight 常几乎看不见；应急 mark 回退保证可见可点
    forceMarkFallback: true,
  });
}

export function bindAnnotateUi(): void {
  ensureAnnotateHighlightCss();
  if (!clickListenerBound) {
    clickListenerBound = true;
    document.addEventListener('click', onDocClick, true);
  }
}

function clearSelectionQuiet(): void {
  const sel = window.getSelection();
  sel?.removeAllRanges();
}

function onDocClick(e: Event): void {
  const me = e as MouseEvent;
  const target = e.target as Element | null;
  if (target && typeof target.closest === 'function') {
    // 主路径：源范围锚
    const anchor = target.closest(
      `[${ANNOTATE_ID_ATTR}], .${ANNOTATE_ANCHOR_CLASS}`,
    );
    if (anchor) {
      const id = anchor.getAttribute(ANNOTATE_ID_ATTR);
      if (id) {
        e.preventDefault();
        e.stopPropagation();
        post('annotateOpen', { ids: [id] });
        return;
      }
    }
    // 应急：旧 mark
    const mark = target.closest(`.${ANNOTATE_MARK_CLASS}`);
    if (mark) {
      const ids = parseAnnotateIdsAttr(mark.getAttribute(ANNOTATE_IDS_ATTR));
      if (ids.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        post('annotateOpen', { ids });
        return;
      }
    }
  }
  if (!isAnnotateDomSearchFallbackEnabled()) {
    return;
  }
  // Highlight 应急：无 mark 时按坐标命中
  const x = typeof me.clientX === 'number' ? me.clientX : 0;
  const y = typeof me.clientY === 'number' ? me.clientY : 0;
  const cssIds = hitTestCssAnnotateIds(x, y);
  if (cssIds.length === 0) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  post('annotateOpen', { ids: cssIds });
}
