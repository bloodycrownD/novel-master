/**
 * WebView transcript boot script (IIFE) — mirrors scroll.ts semantics in the WebView.
 * Bundled into CHAT_TRANSCRIPT_HTML; keep nearBottom threshold in sync with scroll.ts.
 */
import {NEAR_BOTTOM_THRESHOLD_PX} from './scroll';

export function buildTranscriptBootScript(): string {
  return `
(function () {
  var NEAR_BOTTOM = ${NEAR_BOTTOM_THRESHOLD_PX};
  var SCROLL_TOP_LOAD_OLDER = 24;
  var SCHEMA_V = 2;
  var BRIDGE_V = 1;
  var VFS_FILE_TOOLS = { 'vfs.read': 1, 'vfs.write': 1, 'vfs.replace': 1 };
  var state = {
    ready: false,
    nearBottom: true,
    rows: [],
    hasMore: false,
    stream: { text: '', thinking: '' },
    flags: { richText: false, showFullToolParams: false, batchMode: false },
    thinkingExpanded: {},
    scrollRaf: null,
    loadOlderArmed: true,
  };

  function post(type, payload) {
    var msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    }
  }

  function offsetFromBottom(el) {
    return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
  }

  function isNearBottom(el) {
    return offsetFromBottom(el) <= NEAR_BOTTOM;
  }

  function stickToBottom(el) {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    state.nearBottom = true;
  }

  function scheduleStickIfNearBottom() {
    if (!state.nearBottom) return;
    if (state.scrollRaf != null) return;
    state.scrollRaf = requestAnimationFrame(function () {
      state.scrollRaf = null;
      var scroller = document.getElementById('scroller');
      if (scroller) stickToBottom(scroller);
    });
  }

  function emitScrollSnapshot() {
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    var off = offsetFromBottom(scroller);
    var near = off <= NEAR_BOTTOM;
    state.nearBottom = near;
    post('scrollSnapshot', {
      schemaVersion: SCHEMA_V,
      offsetY: off,
      nearBottom: near,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
  }

  var scrollTimer = null;
  function requestLoadOlder() {
    if (!state.hasMore || !state.loadOlderArmed) return;
    state.loadOlderArmed = false;
    post('loadOlder', {});
  }

  function onScroll() {
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    state.nearBottom = isNearBottom(scroller);
    if (scroller.scrollTop <= SCROLL_TOP_LOAD_OLDER) {
      requestLoadOlder();
    }
    if (scrollTimer != null) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      emitScrollSnapshot();
    }, 100);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function vfsToolFilePath(name, input) {
    if (!VFS_FILE_TOOLS[name]) return null;
    var path = input && input.path;
    if (typeof path === 'string' && path.charAt(0) === '/') return path;
    return null;
  }

  function summarizeToolInput(name, input) {
    if (name.indexOf('vfs.') === 0) {
      var path = input && input.path;
      if (typeof path === 'string') return path;
    }
    var keys = input ? Object.keys(input) : [];
    if (keys.length === 0) return '';
    try {
      var raw = JSON.stringify(input);
      return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
    } catch (e) {
      return keys.join(', ');
    }
  }

  function toolCallSummary(row) {
    var fromInput = summarizeToolInput(row.name, row.input || {});
    if (fromInput) return fromInput;
    if (row.resultContent) {
      var t = String(row.resultContent).trim();
      return t.length > 120 ? t.slice(0, 117) + '…' : t;
    }
    return '';
  }

  function toolStatusLabel(status) {
    if (status === 'success') return '成功';
    if (status === 'error') return '失败';
    return '进行中';
  }

  function renderThinkingCard(text, key, expanded, dimmed) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    var chevron = expanded ? '▼' : '▶';
    var body = expanded
      ? '<div class="thinking-body">' + escapeHtml(trimmed) + '</div>'
      : '';
    return (
      '<div class="thinking-card" data-thinking-key="' + escapeHtml(key) + '">' +
      '<div class="thinking-header" data-action="toggle-thinking" data-thinking-key="' + escapeHtml(key) + '">' +
      '<span class="thinking-title">思考过程</span>' +
      '<span class="thinking-chevron">' + chevron + '</span></div>' + body + '</div>'
    );
  }

  function renderToolRow(row) {
    var filePath = vfsToolFilePath(row.name, row.input || {});
    var canOpen = filePath != null;
    var summary = state.flags.showFullToolParams
      ? escapeHtml(JSON.stringify(row.input || {}, null, 2))
      : escapeHtml(toolCallSummary(row));
    var statusClass = row.status === 'success' || row.status === 'error' ? row.status : 'pending';
    var html =
      '<div class="row tool">' +
      '<div class="tool-card' + (canOpen ? ' tappable' : '') + '"' +
      (canOpen ? ' data-action="open-tool-file" data-path="' + escapeHtml(filePath) + '"' : '') +
      '>' +
      '<div class="tool-header">' +
      '<span class="tool-name">' + escapeHtml(row.name || '') + '</span>' +
      '<span class="tool-status ' + statusClass + '">' + toolStatusLabel(row.status) + '</span>' +
      '</div>';
    if (summary) {
      html += '<div class="tool-summary">' + summary + '</div>';
    }
    if (canOpen) {
      html += '<div class="tool-open-hint">点击查看 · 会话工作区</div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderMessageRow(row) {
    var role = row.role === 'user' ? 'user' : 'assistant';
    var hidden = row.hidden ? ' hidden' : '';
    var thinkingKey = 'msg:' + row.id;
    var thinkingExpanded = !!state.thinkingExpanded[thinkingKey];
    var html =
      '<div class="row message ' + role + hidden + '" data-id="' + escapeHtml(row.id) + '">';
    if (row.thinking) {
      html += renderThinkingCard(row.thinking, thinkingKey, thinkingExpanded, row.hidden);
    }
    if (row.text) {
      html += '<div class="bubble">' + escapeHtml(row.text) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderLoadOlder() {
    if (!state.hasMore) return '';
    return '<button type="button" class="load-older" data-action="load-older">加载更早消息</button>';
  }

  function renderEmptyState() {
    var hasStream = !!(state.stream.text || state.stream.thinking);
    if (state.rows.length > 0 || hasStream) return '';
    return '<div class="empty-state">暂无消息</div>';
  }

  function renderRows() {
    var list = document.getElementById('rows');
    if (!list) return;
    var html = renderLoadOlder();
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (row.kind === 'message') {
        html += renderMessageRow(row);
      } else if (row.kind === 'tool') {
        html += renderToolRow(row);
      }
    }
    if (state.stream.thinking) {
      html += renderThinkingCard(state.stream.thinking, 'stream:thinking', true, false);
    }
    if (state.stream.text) {
      html += '<div class="row stream" id="stream-tail"><div class="bubble assistant">' +
        escapeHtml(state.stream.text) + '</div></div>';
    } else if (state.stream.thinking && !state.stream.text) {
      html += '<div class="row stream" id="stream-tail"></div>';
    }
    html += renderEmptyState();
    list.innerHTML = html;
  }

  function applySnapshot(payload, stickBottom) {
    state.rows = (payload.rows || []).slice();
    state.hasMore = !!payload.hasMore;
    state.stream = payload.stream || { text: '', thinking: '' };
    state.loadOlderArmed = true;
    renderRows();
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    if (stickBottom) {
      stickToBottom(scroller);
    }
    scheduleStickIfNearBottom();
    emitScrollSnapshot();
  }

  /**
   * prependPage: only new older rows — NOT a full sessionSnapshot reload.
   * Anchor reading position: scrollTop += scrollHeight - prependedScrollHeight.
   */
  function applyPrependPage(payload) {
    var newRows = (payload.rows || []).slice();
    var scroller = document.getElementById('scroller');
    var prependedScrollHeight = scroller ? scroller.scrollHeight : 0;
    var prependedScrollTop = scroller ? scroller.scrollTop : 0;
    state.rows = newRows.concat(state.rows);
    state.loadOlderArmed = true;
    renderRows();
    if (scroller) {
      var nextScrollHeight = scroller.scrollHeight;
      scroller.scrollTop = prependedScrollTop + (nextScrollHeight - prependedScrollHeight);
      state.nearBottom = isNearBottom(scroller);
    }
    emitScrollSnapshot();
  }

  function appendStreamDelta(kind, delta) {
    if (kind === 'text') state.stream.text += delta;
    else state.stream.thinking += delta;
    var tail = document.getElementById('stream-tail');
    if (tail) {
      if (kind === 'text') {
        var bubble = tail.querySelector('.bubble');
        if (bubble) {
          bubble.textContent = state.stream.text || '';
        } else if (state.stream.text) {
          var el = document.createElement('div');
          el.className = 'bubble assistant';
          el.textContent = state.stream.text;
          tail.appendChild(el);
        }
      } else {
        renderRows();
      }
    } else {
      renderRows();
    }
    scheduleStickIfNearBottom();
  }

  function onRowsClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');
    if (action === 'toggle-thinking') {
      var key = actionEl.getAttribute('data-thinking-key');
      if (key) {
        state.thinkingExpanded[key] = !state.thinkingExpanded[key];
        renderRows();
      }
      return;
    }
    if (action === 'open-tool-file') {
      var path = actionEl.getAttribute('data-path');
      if (path) post('openToolFile', { path: path });
      return;
    }
    if (action === 'load-older') {
      requestLoadOlder();
    }
  }

  function handleHostMessage(raw) {
    var msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!msg || msg.v !== BRIDGE_V || !msg.type) return;
    var p = msg.payload || {};
    switch (msg.type) {
      case 'init':
        if (p.theme) {
          var root = document.documentElement;
          root.style.setProperty('--bg', p.theme.background || '#fff');
          root.style.setProperty('--text', p.theme.text || '#111');
          root.style.setProperty('--text-secondary', p.theme.textSecondary || '#666');
          root.style.setProperty('--primary', p.theme.primary || '#007aff');
          root.style.setProperty('--surface', p.theme.surface || '#f2f2f7');
          root.style.setProperty('--border', p.theme.borderLight || '#e5e5ea');
        }
        if (p.flags) {
          state.flags = {
            richText: !!p.flags.richText,
            showFullToolParams: !!p.flags.showFullToolParams,
            batchMode: !!p.flags.batchMode,
          };
        }
        break;
      case 'sessionSnapshot':
        applySnapshot(p, true);
        break;
      case 'prependPage':
        applyPrependPage(p);
        break;
      case 'streamDelta':
        appendStreamDelta(p.kind, p.delta || '');
        break;
      case 'streamReset':
        state.stream = { text: '', thinking: '' };
        renderRows();
        break;
      case 'flagsUpdate':
        if (p.flags) {
          state.flags = {
            richText: !!p.flags.richText,
            showFullToolParams: !!p.flags.showFullToolParams,
            batchMode: !!p.flags.batchMode,
          };
          renderRows();
        }
        break;
      default:
        break;
    }
  }

  function onHostMessage(event) {
    var data = event && event.data;
    if (data == null) return;
    handleHostMessage(data);
  }

  document.addEventListener('message', onHostMessage);
  window.addEventListener('message', onHostMessage);

  document.addEventListener('DOMContentLoaded', function () {
    var scroller = document.getElementById('scroller');
    var rows = document.getElementById('rows');
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    if (rows) rows.addEventListener('click', onRowsClick);
    post('ready', { version: 'm1' });
    state.ready = true;
  });
})();
`.trim();
}
