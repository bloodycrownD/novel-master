import { escapeHtml } from '../util/html-escape';
import { state } from '../state/state';
import type {
  AttachmentChip,
  MessageRow,
  ToolCallRow,
  TranscriptFlags,
  TranscriptRow,
  UserVfsTurnRow,
} from '../state/state';
import {
  renderToolGroupSection,
  renderToolInvokingBar,
} from './tool-render';
import {
  assistantBubbleExtraClasses,
  renderStreamTailRow,
} from '../stream/stream';
/**
 * 消息行 / 思考 / 附件 / 助手气泡 / 用户 VFS 行渲染。
 */
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

export function attachmentChipLabel(a: AttachmentChip): string {
  if (a.source === 'user_ops') {
    return a.name || '';
  }
  const path = a.path || a.name || '';
  if (a.type === 'dir') {
    return '📁' + path;
  }
  return '📄' + path;
}

export function attachmentSourceLabel(a: AttachmentChip): string {
  if (a.source === 'workplace') {
    return '工作区';
  }
  if (a.source === 'user_ops') {
    return '';
  }
  return a.type === 'dir' ? '目录' : '文件';
}

/** 对齐工具调用组：可折叠 header + surface 卡片列表。 */
export function renderAttachGroupSection(
  attachments: AttachmentChip[] | null | undefined,
  key: string,
  expanded: boolean,
  showDividerAbove: boolean,
): string {
  if (!attachments || attachments.length === 0) {
    return '';
  }
  const isExpanded = !!expanded;
  const chevron = isExpanded ? '▼' : '▶';
  const divided = showDividerAbove ? ' attach-group-divided-above' : '';
  let html =
    '<div class="tool-group-section attach-group-section' +
    divided +
    '" data-attach-group-key="' +
    escapeHtml(key) +
    '">' +
    '<div class="tool-group-header" data-action="toggle-attach-group" data-attach-group-key="' +
    escapeHtml(key) +
    '">' +
    '<span class="tool-group-title">消息附件 (' +
    attachments.length +
    ')</span>' +
    '<span class="tool-group-chevron">' +
    chevron +
    '</span></div>';
  if (isExpanded) {
    html += '<div class="tool-group-items">';
    for (let ai = 0; ai < attachments.length; ai++) {
      const a = attachments[ai];
      html +=
        '<div class="tool-group-item tool-card attach-card">' +
        '<div class="tool-header">' +
        '<span class="tool-name">' +
        escapeHtml(attachmentChipLabel(a)) +
        '</span>' +
        (attachmentSourceLabel(a)
          ? '<span class="tool-status success">' +
            escapeHtml(attachmentSourceLabel(a)) +
            '</span>'
          : '') +
        '</div></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

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

export type ToolOnlyBubbleOptions = {
  bubbleExtraClass?: string;
  groupTitle?: string;
};

export function renderToolOnlyBubble(
  tools: ToolCallRow[],
  toolGroupKey: string,
  toolGroupExpanded: boolean,
  options?: ToolOnlyBubbleOptions,
): string {
  let bubbleClass = 'bubble bubble--fill-width';
  if (options && options.bubbleExtraClass) {
    bubbleClass += ' ' + options.bubbleExtraClass;
  }
  const sectionOpts =
    options && options.groupTitle ? { groupTitle: options.groupTitle } : undefined;
  return (
    '<div class="' +
    bubbleClass +
    '">' +
    renderToolGroupSection(tools, toolGroupKey, toolGroupExpanded, false, sectionOpts) +
    '</div>'
  );
}

export function renderUserVfsTurnRow(row: UserVfsTurnRow): string {
  if (!row.tools || row.tools.length === 0) {
    return '';
  }
  const hidden = row.hidden ? ' hidden' : '';
  let html =
    '<div class="row message user vfs-turn-row' +
    hidden +
    '" data-id="' +
    escapeHtml(row.id) +
    '">';
  const toolGroupKey = 'vfs-turn:' + row.id;
  const toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
  html += renderToolOnlyBubble(row.tools, toolGroupKey, toolGroupExpanded, {
    groupTitle: '用户操作 (' + row.tools.length + ')',
    bubbleExtraClass: 'vfs-turn-bubble',
  });
  html += '</div>';
  return html;
}

export function renderRow(row: TranscriptRow): string {
  if (row.kind === 'user_vfs_turn') {
    return renderUserVfsTurnRow(row);
  }
  if (row.kind === 'message') {
    return renderMessageRow(row);
  }
  return '';
}

export function renderUserBubbleContent(text: unknown): string {
  // VFS 操作卡只走结构化 row.kind === 'user_vfs_turn'；正文不再兜底解析 <action>
  return escapeHtml(text);
}

export function renderMessageRow(row: MessageRow): string {
  const role = row.role === 'user' ? 'user' : 'assistant';
  const hidden = row.hidden ? ' hidden' : '';
  const thinkingKey = 'msg:' + row.id;
  const thinkingExpanded = !!state.thinkingExpanded[thinkingKey];
  let html =
    '<div class="row message ' + role + hidden + '" data-id="' + escapeHtml(row.id) + '">';
  if (role === 'user') {
    const attachments = row.attachments || [];
    const hasAttach = attachments.length > 0;
    const hasText = !!(row.text && String(row.text).length > 0);
    if (hasAttach || hasText) {
      if (hasAttach) {
        // 正文在上、附件组在下，合进同一条 bubble
        const attachKey = 'attach:' + row.id;
        const attachExpanded = !!state.attachGroupExpanded[attachKey];
        html +=
          '<div class="bubble bubble--fill-width bubble--user-compose">' +
          (hasText
            ? '<div class="bubble-body">' + renderUserBubbleContent(row.text) + '</div>'
            : '') +
          renderAttachGroupSection(attachments, attachKey, attachExpanded, hasText) +
          '</div>';
      } else {
        html +=
          '<div class="bubble">' + renderUserBubbleContent(row.text) + '</div>';
      }
    }
  } else if (row.thinking || row.text || (row.tools && row.tools.length > 0)) {
    const toolGroupKey = 'msg:' + row.id;
    const toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
    html +=
      '<div class="bubble' +
      assistantBubbleExtraClasses(row.textHtml, row.tools, row.text, row.thinking) +
      '">' +
      renderAssistantBubbleInner(
        row.text,
        row.textHtml,
        row.thinking,
        thinkingKey,
        thinkingExpanded,
        row.thinkingHtml,
        row.tools,
        toolGroupKey,
        toolGroupExpanded,
        false,
      ) +
      '</div>';
  }
  html += '</div>';
  return html;
}

export function renderLoadOlder(): string {
  if (!state.hasMore) return '';
  return '<button type="button" class="load-older" data-action="load-older">加载更早消息</button>';
}

export function renderEmptyState(): string {
  const hasStream = !!(
    state.stream.text ||
    state.stream.thinking ||
    state.stream.toolInvoking
  );
  if (state.rows.length > 0 || hasStream) return '';
  return '<div class="empty-state">暂无消息</div>';
}

export function flagsEqual(a: TranscriptFlags, b: TranscriptFlags): boolean {
  return a.richText === b.richText && a.menuDisabled === b.menuDisabled;
}

export function renderRows(): void {
  const list = document.getElementById('rows');
  if (!list) return;
  let html = renderLoadOlder();
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i];
    if (row.kind === 'message' || row.kind === 'user_vfs_turn') {
      html += renderRow(row);
    }
  }
  html += renderStreamTailRow();
  html += renderEmptyState();
  list.innerHTML = html;
}
