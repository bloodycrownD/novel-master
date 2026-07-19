/**
 * rich-document 划词批注：选区浮动条、下划线、点击打开。
 */
import { post } from './post';
import {
  applyAnnotateMarks,
  type AnnotateMark,
} from './annotate-marks';

let annotateEnabled = false;
let annotations: AnnotateMark[] = [];
let barEl: HTMLDivElement | null = null;
let selectionListenerBound = false;
let clickListenerBound = false;
let selectionShowTimer: number | null = null;

export function setAnnotateEnabled(enabled: boolean): void {
  annotateEnabled = enabled === true;
  if (!annotateEnabled) {
    hideAnnotateBar();
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
  if (!selectionListenerBound) {
    selectionListenerBound = true;
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('touchend', onSelectionGestureEnd, true);
    document.addEventListener('mouseup', onSelectionGestureEnd, true);
  }
  if (!clickListenerBound) {
    clickListenerBound = true;
    document.addEventListener('click', onDocClick, true);
  }
}

function scheduleShowAnnotateBar(): void {
  if (selectionShowTimer != null) {
    window.clearTimeout(selectionShowTimer);
  }
  // 原生 ActionMode 弹出后选区才稳定；兼作 selectionchange 防抖
  selectionShowTimer = window.setTimeout(() => {
    selectionShowTimer = null;
    if (!annotateEnabled) {
      hideAnnotateBar();
      return;
    }
    const text = readDocSelectionText();
    if (!text) {
      hideAnnotateBar();
      return;
    }
    showAnnotateBar(text);
  }, 280);
}

function onSelectionChange(): void {
  if (!annotateEnabled) {
    hideAnnotateBar();
    return;
  }
  const text = readDocSelectionText();
  if (!text) {
    hideAnnotateBar();
    return;
  }
  // 长按选区常无可靠 touchend；有选区时也调度显示浮动条（与原生 menuItems 双通道）
  scheduleShowAnnotateBar();
}

function onSelectionGestureEnd(): void {
  if (!annotateEnabled) {
    hideAnnotateBar();
    return;
  }
  scheduleShowAnnotateBar();
}

function readDocSelectionText(): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) {
    return '';
  }
  const range = sel.getRangeAt(0);
  const docEl = document.getElementById('doc');
  if (!docEl) {
    return '';
  }
  if (
    !docEl.contains(range.commonAncestorContainer) &&
    range.commonAncestorContainer !== docEl
  ) {
    return '';
  }
  const text = String(sel.toString() ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  return text;
}

function showAnnotateBar(selectedText: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount < 1) {
    return;
  }
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  ensureBar();
  if (!barEl) {
    return;
  }
  barEl.dataset.selectedText = selectedText;
  barEl.style.display = 'flex';
  barEl.style.position = 'fixed';
  barEl.style.top = `${Math.max(8, rect.top - 40)}px`;
  barEl.style.left = `${Math.min(
    Math.max(8, rect.left + rect.width / 2 - 48),
    window.innerWidth - 112,
  )}px`;
}

function hideAnnotateBar(): void {
  if (barEl) {
    barEl.style.display = 'none';
    delete barEl.dataset.selectedText;
  }
}

function ensureBar(): void {
  if (barEl) {
    return;
  }
  const el = document.createElement('div');
  el.id = 'annotate-bar';
  el.className = 'annotate-bar';
  el.style.display = 'none';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'annotate-bar-btn';
  btn.textContent = '添加批注';
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const text = el.dataset.selectedText || readDocSelectionText();
    if (!text) {
      hideAnnotateBar();
      return;
    }
    post('selectionAnnotate', { text });
    hideAnnotateBar();
    clearSelectionQuiet();
  });
  el.appendChild(btn);
  document.body.appendChild(el);
  barEl = el;
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
  const mark = target.closest(`.annotate-mark`);
  if (!mark) {
    return;
  }
  const id = mark.getAttribute('data-annotate-id');
  if (!id) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  hideAnnotateBar();
  post('annotateOpen', { id });
}
