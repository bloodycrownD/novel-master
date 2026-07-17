import { escapeHtml } from '../util/html-escape';
import { vfsToolFilePath } from '../util/vfs-tool-path';
import type { ToolCallRow } from '../state/state';

/**
 * 工具调用摘要、状态标签与工具组 HTML 渲染。
 */
export function summarizeToolInput(
  _name: string,
  input: Record<string, unknown> | null | undefined,
): string {
  const path = input && (input.path || input.dir || input.from);
  if (typeof path === 'string') return path;
  const keys = input ? Object.keys(input) : [];
  if (keys.length === 0) return '';
  try {
    const raw = JSON.stringify(input);
    return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
  } catch {
    return keys.join(', ');
  }
}

export function toolCallSummary(row: ToolCallRow): string {
  if (row.status === 'error' && row.summary) {
    return row.summary;
  }
  const fromInput = summarizeToolInput(row.name || '', row.input || {});
  if (fromInput) return fromInput;
  if (row.resultContent) {
    const t = String(row.resultContent).trim();
    return t.length > 120 ? t.slice(0, 117) + '…' : t;
  }
  return '';
}

export function toolStatusLabel(status: string | undefined): string {
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'pending') return '执行中';
  if (status === 'interrupted') return '已中断';
  return '';
}

export function renderToolInvokingBar(): string {
  return (
    '<div class="tool-invoking-bar">' +
    '<span class="tool-invoking-dot" aria-hidden="true"></span>' +
    '<span class="tool-invoking-label">生成中</span></div>'
  );
}

export function renderToolGroupItem(tool: ToolCallRow): string {
  const filePath = vfsToolFilePath(tool.name || '', tool.input || {});
  const canOpen = filePath != null;
  const summary = toolCallSummary(tool);
  let statusClass: string;
  if (tool.status === 'error') {
    statusClass = 'error';
  } else if (tool.status === 'pending') {
    statusClass = 'pending';
  } else if (tool.status === 'interrupted') {
    statusClass = 'interrupted';
  } else {
    statusClass = 'success';
  }
  const statusInner = toolStatusLabel(tool.status);
  let html =
    '<div class="tool-group-item tool-card' +
    (canOpen ? ' tappable' : '') +
    '"' +
    (canOpen ? ' data-action="open-tool-file" data-path="' + escapeHtml(filePath) + '"' : '') +
    '>' +
    '<div class="tool-header">' +
    '<span class="tool-name">' +
    escapeHtml(tool.name || '') +
    '</span>' +
    '<span class="tool-status ' +
    statusClass +
    '">' +
    statusInner +
    '</span>' +
    '</div>';
  if (summary) {
    html += '<div class="tool-summary">' + escapeHtml(summary) + '</div>';
  }
  if (canOpen) {
    html += '<div class="tool-open-hint">点击查看 · 聊天工作区</div>';
  }
  html += '</div>';
  return html;
}

export type ToolGroupSectionOptions = {
  groupTitle?: string;
};

export function renderToolGroupSection(
  tools: ToolCallRow[] | null | undefined,
  key: string,
  expanded: boolean,
  showDividerBelow: boolean,
  options?: ToolGroupSectionOptions,
): string {
  if (!tools || tools.length === 0) return '';
  const isExpanded = expanded;
  const chevron = isExpanded ? '▼' : '▶';
  const divided = isExpanded && showDividerBelow ? ' tool-group-divided' : '';
  const groupTitle =
    options && options.groupTitle
      ? options.groupTitle
      : '工具调用 (' + tools.length + ')';
  let html =
    '<div class="tool-group-section' +
    divided +
    '" data-tool-group-key="' +
    escapeHtml(key) +
    '">' +
    '<div class="tool-group-header" data-action="toggle-tool-group" data-tool-group-key="' +
    escapeHtml(key) +
    '">' +
    '<span class="tool-group-title">' +
    escapeHtml(groupTitle) +
    '</span>' +
    '<span class="tool-group-chevron">' +
    chevron +
    '</span></div>';
  if (isExpanded) {
    html += '<div class="tool-group-items">';
    for (let ti = 0; ti < tools.length; ti++) {
      html += renderToolGroupItem(tools[ti]);
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}
