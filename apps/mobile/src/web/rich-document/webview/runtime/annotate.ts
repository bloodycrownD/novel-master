/**
 * rich-document 划词批注：下划线、点击打开。
 * 「添加批注」由 RN WebView `menuItems` 提供（见 RichDocumentWebView）；
 * 不再叠 DOM 浮动条，避免与原生选区菜单双开。
 */
import {post} from './post';
import {
  ANNOTATE_IDS_ATTR,
  ANNOTATE_MARK_CLASS,
  applyAnnotateMarks,
  parseAnnotateIdsAttr,
  type AnnotateMark,
} from './annotate-marks';

let annotateEnabled = false;
let annotations: AnnotateMark[] = [];
let clickListenerBound = false;

export function setAnnotateEnabled(enabled: boolean): void {
  annotateEnabled = enabled === true;
  if (!annotateEnabled) {
    clearSelectionQuiet();
  }
  refreshAnnotateMarks();
}

export function setAnnotations(next: readonly AnnotateMark[]): void {
  annotations = Array.isArray(next)
    ? next.map(a => ({
        id: String(a.id ?? ''),
        originalText: String(a.originalText ?? ''),
      }))
    : [];
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
  applyAnnotateMarks(body, annotations);
}

export function bindAnnotateUi(): void {
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
  const target = e.target as Element | null;
  if (!target || typeof target.closest !== 'function') {
    return;
  }
  const mark = target.closest(`.${ANNOTATE_MARK_CLASS}`);
  if (!mark) {
    return;
  }
  const ids = parseAnnotateIdsAttr(mark.getAttribute(ANNOTATE_IDS_ATTR));
  if (ids.length === 0) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  post('annotateOpen', {ids});
}
