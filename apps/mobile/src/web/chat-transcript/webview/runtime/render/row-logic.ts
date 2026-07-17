import { escapeHtml } from '../util/html-escape';
import { state } from '../state/state';
import type { ToolCallRow, TranscriptFlags } from '../state/state';
import { renderToolGroupSection, renderToolInvokingBar } from './tool-logic';

/**
 * P0-3：renderRows 门面 + flagsEqual + 流式仍依赖的助手气泡 HTML 拼串。
 * 行列表结构主路径在 ui/render；由 main 注册 Preact 实现。
 */

export type RenderRowsView = () => void;

let _renderRowsView: RenderRowsView | null = null;

/** 由 main 注册 Preact（或其它）行列表刷新实现。 */
export function registerRenderRows(fn: RenderRowsView): void {
  _renderRowsView = fn;
}

/** 调用已注册实现；未注册时返回 false。 */
export function invokeRegisteredRenderRows(): boolean {
  if (!_renderRowsView) return false;
  _renderRowsView();
  return true;
}

export function flagsEqual(a: TranscriptFlags, b: TranscriptFlags): boolean {
  return a.richText === b.richText && a.menuDisabled === b.menuDisabled;
}

/**
 * 行列表全量刷新门面：只转发已注册实现（禁止在此拼串 / preact.render）。
 */
export function renderRows(): void {
  invokeRegisteredRenderRows();
}

/** 附件芯片主标签（明文）。 */
export function attachmentChipLabel(a: {
  source?: string;
  type?: string;
  name?: string;
  path?: string;
}): string {
  if (a.source === 'user_ops') {
    return a.name || '';
  }
  const path = a.path || a.name || '';
  if (a.type === 'dir') {
    return '📁' + path;
  }
  return '📄' + path;
}

/** 附件来源副标签（明文）。 */
export function attachmentSourceLabel(a: {
  source?: string;
  type?: string;
}): string {
  if (a.source === 'workplace') {
    return '工作区';
  }
  if (a.source === 'user_ops') {
    return '';
  }
  return a.type === 'dir' ? '目录' : '文件';
}

export function thinkingBodyInner(
  text: unknown,
  thinkingHtml: string | null | undefined,
): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (state.flags.richText && thinkingHtml) {
    return thinkingHtml;
  }
  return escapeHtml(trimmed);
}

export function renderThinkingSection(
  text: unknown,
  key: string,
  expanded: boolean,
  thinkingHtml: string | null | undefined,
  showDividerBelow: boolean,
): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const chevron = expanded ? '▼' : '▶';
  const richClass = state.flags.richText && thinkingHtml ? ' rich' : '';
  let bodyClass = 'thinking-body' + richClass;
  if (expanded && showDividerBelow) {
    bodyClass += ' thinking-body-divided';
  }
  const body = expanded
    ? '<div class="' + bodyClass + '">' + thinkingBodyInner(text, thinkingHtml) + '</div>'
    : '';
  return (
    '<div class="thinking-section" data-thinking-key="' +
    escapeHtml(key) +
    '">' +
    '<div class="thinking-header" data-action="toggle-thinking" data-thinking-key="' +
    escapeHtml(key) +
    '">' +
    '<span class="thinking-title">思考过程</span>' +
    '<span class="thinking-chevron">' +
    chevron +
    '</span></div>' +
    body +
    '</div>'
  );
}

/**
 * 流式 updateStreamBubble / renderStreamBubbleInner 仍用字符串整泡替换。
 * 消息行主路径已迁 ui/render/AssistantBubble。
 */
export function renderAssistantBubbleInner(
  text: unknown,
  textHtml: string | null | undefined,
  thinking: unknown,
  thinkingKey: string,
  thinkingExpanded: boolean,
  thinkingHtml: string | null | undefined,
  tools: ToolCallRow[] | null | undefined,
  toolGroupKey: string,
  toolGroupExpanded: boolean,
  showToolInvoking: boolean,
): string {
  let html = '';
  const hasThinking = !!(thinking && String(thinking).trim());
  const hasTools = !!(tools && tools.length > 0);
  const hasInvoking = !!showToolInvoking;
  const hasText = !!(text && String(text).trim());
  if (hasThinking) {
    html += renderThinkingSection(
      thinking,
      thinkingKey,
      thinkingExpanded,
      thinkingHtml,
      hasText || hasTools || hasInvoking,
    );
  }
  if (hasText) {
    const richBubble = state.flags.richText && textHtml ? ' rich' : '';
    const inner = textHtml || escapeHtml(text || '');
    html += '<div class="bubble-body' + richBubble + '">' + inner + '</div>';
  } else if (hasThinking) {
    // WHY: 仅有 thinking、正文为空时预置空 .bubble-body，供后续 text 增量挂载。
    const richShellBubble = state.flags.richText && textHtml ? ' rich' : '';
    html +=
      '<div class="bubble-body' + richShellBubble + '" data-text-shell="1"></div>';
  }
  if (hasInvoking) {
    html += renderToolInvokingBar();
  }
  if (hasTools) {
    html += renderToolGroupSection(tools, toolGroupKey, toolGroupExpanded, false);
  }
  return html;
}
