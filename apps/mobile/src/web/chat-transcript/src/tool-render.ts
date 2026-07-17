// @ts-nocheck
import { escapeHtml } from './html-escape';
import { vfsToolFilePath } from './vfs-tool-path';
/**
 * 工具调用摘要、状态标签与工具组 HTML 渲染。
 */
export function summarizeToolInput(name, input) {
    var path = input && (input.path || input.dir || input.from);
    if (typeof path === 'string') return path;
    var keys = input ? Object.keys(input) : [];
    if (keys.length === 0) return '';
    try {
      var raw = JSON.stringify(input);
      return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
    } catch (e) {
      return keys.join(', ');
    }
  }

export function toolCallSummary(row) {
    if (row.status === 'error' && row.summary) {
      return row.summary;
    }
    var fromInput = summarizeToolInput(row.name, row.input || {});
    if (fromInput) return fromInput;
    if (row.resultContent) {
      var t = String(row.resultContent).trim();
      return t.length > 120 ? t.slice(0, 117) + '…' : t;
    }
    return '';
  }

export function toolStatusLabel(status) {
    if (status === 'success') return '成功';
    if (status === 'error') return '失败';
    if (status === 'pending') return '执行中';
    if (status === 'interrupted') return '已中断';
    return '';
  }

export function renderToolInvokingBar() {
    return (
      '<div class="tool-invoking-bar">' +
      '<span class="tool-invoking-dot" aria-hidden="true"></span>' +
      '<span class="tool-invoking-label">生成中</span></div>'
    );
  }

export function renderToolGroupItem(tool) {
    var filePath = vfsToolFilePath(tool.name, tool.input || {});
    var canOpen = filePath != null;
    var summary = toolCallSummary(tool);
    var statusClass = tool.status === 'error'
      ? 'error'
      : (tool.status === 'pending'
        ? 'pending'
        : (tool.status === 'interrupted' ? 'interrupted' : 'success'));
    var statusInner = toolStatusLabel(tool.status);
    var html =
      '<div class="tool-group-item tool-card' + (canOpen ? ' tappable' : '') + '"' +
      (canOpen ? ' data-action="open-tool-file" data-path="' + escapeHtml(filePath) + '"' : '') +
      '>' +
      '<div class="tool-header">' +
      '<span class="tool-name">' + escapeHtml(tool.name || '') + '</span>' +
      '<span class="tool-status ' + statusClass + '">' + statusInner + '</span>' +
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

export function renderToolGroupSection(tools, key, expanded, showDividerBelow, options) {
    if (!tools || tools.length === 0) return '';
    var isExpanded = expanded;
    var chevron = isExpanded ? '▼' : '▶';
    var divided = isExpanded && showDividerBelow ? ' tool-group-divided' : '';
    var groupTitle =
      options && options.groupTitle
        ? options.groupTitle
        : '工具调用 (' + tools.length + ')';
    var html =
      '<div class="tool-group-section' + divided + '" data-tool-group-key="' + escapeHtml(key) + '">' +
      '<div class="tool-group-header" data-action="toggle-tool-group" data-tool-group-key="' + escapeHtml(key) + '">' +
      '<span class="tool-group-title">' + escapeHtml(groupTitle) + '</span>' +
      '<span class="tool-group-chevron">' + chevron + '</span></div>';
    if (isExpanded) {
      html += '<div class="tool-group-items">';
      for (var ti = 0; ti < tools.length; ti++) {
        html += renderToolGroupItem(tools[ti]);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }
