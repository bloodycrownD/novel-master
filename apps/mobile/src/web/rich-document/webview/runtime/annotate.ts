/**
 * rich-document 划词批注：下划线、点击打开。
 * 「添加批注」由 RN WebView `menuItems` 提供（见 RichDocumentWebView）；
 * 不再叠 DOM 浮动条，避免与原生选区菜单双开。
 * H1/H4：Highlight 主路径点击走 hit-test；mark 回退仍 closest。
 */
import {post} from './post';
import {
  ANNOTATE_IDS_ATTR,
  ANNOTATE_MARK_CLASS,
  applyAnnotateMarks,
  hitTestCssAnnotateIds,
  parseAnnotateIdsAttr,
  type AnnotateMark,
} from './annotate-marks';
import {ensureAnnotateHighlightCss} from './annotate-highlight-css';

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
        ...(typeof a.startLine === 'number' ? {startLine: a.startLine} : {}),
        ...(typeof a.endLine === 'number' ? {endLine: a.endLine} : {}),
        ...(typeof a.startCol === 'number' ? {startCol: a.startCol} : {}),
        ...(typeof a.endCol === 'number' ? {endCol: a.endCol} : {}),
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

/** setDocument 渲染后调用，重建下划线。 */
export function refreshAnnotateMarks(): void {
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
    const mark = target.closest(`.${ANNOTATE_MARK_CLASS}`);
    if (mark) {
      const ids = parseAnnotateIdsAttr(mark.getAttribute(ANNOTATE_IDS_ATTR));
      if (ids.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        post('annotateOpen', {ids});
        return;
      }
    }
  }
  // Highlight 主路径：无 mark 时按坐标命中（H4）
  const x = typeof me.clientX === 'number' ? me.clientX : 0;
  const y = typeof me.clientY === 'number' ? me.clientY : 0;
  const cssIds = hitTestCssAnnotateIds(x, y);
  if (cssIds.length === 0) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  post('annotateOpen', {ids: cssIds});
}
