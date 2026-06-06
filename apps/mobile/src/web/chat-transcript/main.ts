/**
 * WebView transcript boot script (IIFE) — mirrors scroll.ts semantics in the WebView.
 * Bundled into CHAT_TRANSCRIPT_HTML; keep nearBottom threshold in sync with scroll.ts.
 */
import {MENU_OPEN_GRACE_MS} from './menu-overlay-guards';
import {NEAR_BOTTOM_THRESHOLD_PX} from './scroll';

export function buildTranscriptBootScript(): string {
  return `
(function () {
  var NEAR_BOTTOM = ${NEAR_BOTTOM_THRESHOLD_PX};
  var MENU_OPEN_GRACE_MS = ${MENU_OPEN_GRACE_MS};
  var SCROLL_TOP_LOAD_OLDER = 24;
  var SCHEMA_V = 2;
  var BRIDGE_V = 1;
  var VFS_FILE_TOOLS = { 'vfs.read': 1, 'vfs.write': 1, 'vfs.replace': 1 };
  var state = {
    ready: false,
    nearBottom: true,
    sessionKey: '',
    rows: [],
    hasMore: false,
    stream: { text: '', thinking: '', textHtml: '', thinkingHtml: '' },
    flags: { richText: false, showFullToolParams: false, batchMode: false, menuDisabled: false },
    selectedIds: [],
    menu: null,
    menuOverlayHandler: null,
    thinkingExpanded: {},
    scrollRaf: null,
    loadOlderArmed: true,
    longPressTimer: null,
    longPressTarget: null,
    menuOpenedAt: 0,
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

  function assistantBubbleInner(row) {
    if (state.flags.richText && row.textHtml) {
      return row.textHtml;
    }
    return escapeHtml(row.text || '');
  }

  function thinkingBodyInner(text, thinkingHtml) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if (state.flags.richText && thinkingHtml) {
      return thinkingHtml;
    }
    return escapeHtml(trimmed);
  }

  function renderThinkingCard(text, key, expanded, thinkingHtml) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    var chevron = expanded ? '▼' : '▶';
    var richClass = state.flags.richText && thinkingHtml ? ' rich' : '';
    var body = expanded
      ? '<div class="thinking-body' + richClass + '">' + thinkingBodyInner(text, thinkingHtml) + '</div>'
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

  function findMessageRow(messageId) {
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (row.kind === 'message' && row.id === messageId) return row;
    }
    return null;
  }

  function isSelected(messageId) {
    return state.selectedIds.indexOf(messageId) >= 0;
  }

  function buildMenuItems(row) {
    var items = [];
    if (row.text) items.push({ label: '编辑', action: 'edit' });
    if (row.hidden) items.push({ label: '取消隐藏', action: 'unhide' });
    else items.push({ label: '隐藏', action: 'hide' });
    items.push({ label: '复制', action: 'copy' });
    items.push({ label: 'Fork', action: 'fork' });
    items.push({ label: '回滚', action: 'rollback', danger: true });
    items.push({ label: '删除', action: 'delete', danger: true });
    return items;
  }

  function closeContextMenu(notifyHost) {
    if (!state.menu) return;
    state.menu = null;
    state.menuOpenedAt = 0;
    if (state.menuOverlayHandler) {
      document.removeEventListener('click', state.menuOverlayHandler, true);
      document.removeEventListener('touchend', state.menuOverlayHandler, true);
      state.menuOverlayHandler = null;
    }
    var menuEl = document.getElementById('context-menu');
    if (menuEl) menuEl.remove();
    var backdrop = document.getElementById('menu-backdrop');
    if (backdrop) backdrop.remove();
    if (notifyHost !== false) post('menuClosed', {});
  }

  function handleMenuOverlayEvent(event) {
    if (!state.menu) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var menuEl = document.getElementById('context-menu');
    if (menuEl && menuEl.contains(target)) {
      var actionEl = target.closest('[data-action="menu-action"]');
      if (actionEl) {
        if (event.type === 'touchend') event.preventDefault();
        var messageId = actionEl.getAttribute('data-message-id');
        var menuAction = actionEl.getAttribute('data-menu-action');
        closeContextMenu(true);
        if (messageId && menuAction) {
          post('messageMenuAction', { messageId: messageId, action: menuAction });
        }
      }
      return;
    }
    var rowEl = target.closest('.row.message');
    if (rowEl && event.type === 'touchend' && state.menuOpenedAt &&
        Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS) {
      return;
    }
    // Backdrop lives on document.body outside #rows — capture dismiss here.
    closeContextMenu(true);
  }

  function renderContextMenu() {
    if (!state.menu) return;
    var menu = state.menu;
    var existingMenu = document.getElementById('context-menu');
    if (existingMenu) existingMenu.remove();
    var existingBackdrop = document.getElementById('menu-backdrop');
    if (existingBackdrop) existingBackdrop.remove();
    var backdrop = document.createElement('div');
    backdrop.id = 'menu-backdrop';
    backdrop.className = 'menu-backdrop';
    backdrop.setAttribute('data-action', 'close-menu');
    var menuEl = document.createElement('div');
    menuEl.id = 'context-menu';
    menuEl.className = 'context-menu';
    menuEl.style.left = Math.max(8, menu.pageX - 66) + 'px';
    menuEl.style.top = Math.max(8, menu.pageY - 12) + 'px';
    var html = '';
    for (var i = 0; i < menu.items.length; i++) {
      var item = menu.items[i];
      html +=
        '<button type="button" class="menu-item' + (item.danger ? ' danger' : '') + '" data-action="menu-action" data-message-id="' +
        escapeHtml(menu.messageId) + '" data-menu-action="' + escapeHtml(item.action) + '">' +
        escapeHtml(item.label) + '</button>';
    }
    menuEl.innerHTML = html;
    document.body.appendChild(backdrop);
    document.body.appendChild(menuEl);
    state.menuOverlayHandler = handleMenuOverlayEvent;
    document.addEventListener('click', state.menuOverlayHandler, true);
    document.addEventListener('touchend', state.menuOverlayHandler, true);
  }

  function openContextMenu(messageId, pageX, pageY) {
    if (state.flags.menuDisabled || state.flags.batchMode) return;
    var row = findMessageRow(messageId);
    if (!row) return;
    post('openMessageMenu', { messageId: messageId, pageX: pageX, pageY: pageY });
    post('menuOpened', {});
    state.menu = {
      messageId: messageId,
      pageX: pageX,
      pageY: pageY,
      items: buildMenuItems(row),
    };
    state.menuOpenedAt = Date.now();
    renderContextMenu();
  }

  function clearLongPress() {
    if (state.longPressTimer != null) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
    state.longPressTarget = null;
  }

  function onMessagePointerDown(event) {
    if (state.flags.batchMode || state.flags.menuDisabled) return;
    var rowEl = event.target && event.target.closest ? event.target.closest('.row.message') : null;
    if (!rowEl) return;
    var messageId = rowEl.getAttribute('data-id');
    if (!messageId) return;
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    clearLongPress();
    state.longPressTarget = { messageId: messageId, pageX: touch.pageX, pageY: touch.pageY };
    state.longPressTimer = setTimeout(function () {
      state.longPressTimer = null;
      var target = state.longPressTarget;
      state.longPressTarget = null;
      if (target) openContextMenu(target.messageId, target.pageX, target.pageY);
    }, 450);
  }

  function onMessagePointerUp() {
    clearLongPress();
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    root.style.setProperty('--bg', theme.background || '#fff');
    root.style.setProperty('--text', theme.text || '#111');
    root.style.setProperty('--text-secondary', theme.textSecondary || '#666');
    root.style.setProperty('--primary', theme.primary || '#007aff');
    root.style.setProperty('--surface', theme.surface || '#f2f2f7');
    root.style.setProperty('--border', theme.borderLight || '#e5e5ea');
  }

  function renderMessageRow(row) {
    var role = row.role === 'user' ? 'user' : 'assistant';
    var hidden = row.hidden ? ' hidden' : '';
    var thinkingKey = 'msg:' + row.id;
    var thinkingExpanded = !!state.thinkingExpanded[thinkingKey];
    var richBubble = state.flags.richText && row.role === 'assistant' && row.textHtml ? ' rich' : '';
    var selected = isSelected(row.id);
    var selectedClass = selected ? ' selected' : '';
    var html = '';
    if (state.flags.batchMode) {
      html += '<div class="batch-row" data-action="toggle-select" data-id="' + escapeHtml(row.id) + '"><div class="batch-check' + (selected ? ' checked' : '') +
        '" aria-hidden="true">' +
        (selected ? '✓' : '') + '</div><div class="batch-content">';
    }
    html += '<div class="row message ' + role + hidden + selectedClass + '" data-id="' + escapeHtml(row.id) + '">';
    if (row.thinking) {
      html += renderThinkingCard(row.thinking, thinkingKey, thinkingExpanded, row.thinkingHtml);
    }
    if (row.text) {
      var inner = role === 'user' ? escapeHtml(row.text) : assistantBubbleInner(row);
      html += '<div class="bubble' + richBubble + '">' + inner + '</div>';
    }
    html += '</div>';
    if (state.flags.batchMode) {
      html += '</div></div>';
    }
    return html;
  }

  function streamTextInner() {
    if (state.flags.richText && state.stream.textHtml) {
      return state.stream.textHtml;
    }
    return escapeHtml(state.stream.text || '');
  }

  function streamThinkingHtml() {
    if (state.flags.richText && state.stream.thinkingHtml) {
      return state.stream.thinkingHtml;
    }
    return null;
  }

  function streamBubbleRichClass() {
    return state.flags.richText && state.stream.textHtml ? ' rich' : '';
  }

  function updateStreamTextBubble(tail) {
    var bubble = tail.querySelector('.bubble');
    var useRich = !!(state.flags.richText && state.stream.textHtml);
    if (bubble) {
      bubble.className = 'bubble assistant' + (useRich ? ' rich' : '');
      if (useRich) bubble.innerHTML = streamTextInner();
      else bubble.textContent = state.stream.text || '';
      return;
    }
    if (!state.stream.text) return;
    var el = document.createElement('div');
    el.className = 'bubble assistant' + (useRich ? ' rich' : '');
    if (useRich) el.innerHTML = streamTextInner();
    else el.textContent = state.stream.text;
    tail.appendChild(el);
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

  function flagsEqual(a, b) {
    return (
      a.richText === b.richText &&
      a.showFullToolParams === b.showFullToolParams &&
      a.batchMode === b.batchMode &&
      a.menuDisabled === b.menuDisabled
    );
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
      html += renderThinkingCard(
        state.stream.thinking,
        'stream:thinking',
        true,
        streamThinkingHtml()
      );
    }
    if (state.stream.text) {
      html += '<div class="row stream" id="stream-tail"><div class="bubble assistant' +
        streamBubbleRichClass() + '">' + streamTextInner() + '</div></div>';
    } else if (state.stream.thinking && !state.stream.text) {
      html += '<div class="row stream" id="stream-tail"></div>';
    }
    html += renderEmptyState();
    list.innerHTML = html;
  }

  /**
   * I1/I2: scrollIntent from RN — stick on open, restore offsetY from cache, preserve on append.
   * C1: never apply payload.stream; stream tail owned by streamDelta/streamReset only.
   */
  function applySnapshot(payload) {
    var intent = payload.scrollIntent || 'stick';
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevScrollTop = scroller ? scroller.scrollTop : 0;
    var sessionChanged = payload.sessionKey && payload.sessionKey !== state.sessionKey;

    state.sessionKey = payload.sessionKey || state.sessionKey;
    state.rows = (payload.rows || []).slice();
    state.hasMore = !!payload.hasMore;
    state.loadOlderArmed = true;
    if (intent !== 'preserve' || sessionChanged) {
      state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '' };
    }
    if (sessionChanged) {
      closeContextMenu(false);
    }
    renderRows();
    if (!scroller) return;

    if (intent === 'stick') {
      stickToBottom(scroller);
    } else if (intent === 'restore' && payload.restoreScroll) {
      var rs = payload.restoreScroll;
      if (rs.nearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - rs.offsetY
        );
      }
    } else if (intent === 'preserve') {
      if (wasNearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = prevScrollTop;
      }
    }
    state.nearBottom = isNearBottom(scroller);
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

  function appendStreamDelta(kind, delta, html) {
    if (kind === 'text') {
      state.stream.text += delta;
      if (html) {
        state.stream.textHtml = html;
      } else if (state.flags.richText) {
        state.stream.textHtml = '';
      }
    } else {
      state.stream.thinking += delta;
      if (html) {
        state.stream.thinkingHtml = html;
      } else if (state.flags.richText) {
        state.stream.thinkingHtml = '';
      }
    }
    var tail = document.getElementById('stream-tail');
    if (tail) {
      if (kind === 'text') {
        updateStreamTextBubble(tail);
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
    if (action === 'toggle-select') {
      var selectId = actionEl.getAttribute('data-id');
      if (selectId) post('toggleMessageSelect', { messageId: selectId });
      return;
    }
    if (action === 'close-menu') {
      closeContextMenu(true);
      return;
    }
    if (action === 'menu-action') {
      var messageId = actionEl.getAttribute('data-message-id');
      var menuAction = actionEl.getAttribute('data-menu-action');
      closeContextMenu(true);
      if (messageId && menuAction) {
        post('messageMenuAction', { messageId: messageId, action: menuAction });
      }
      return;
    }
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
        applyTheme(p.theme);
        if (p.flags) {
          state.flags = {
            richText: !!p.flags.richText,
            showFullToolParams: !!p.flags.showFullToolParams,
            batchMode: !!p.flags.batchMode,
            menuDisabled: !!p.flags.menuDisabled,
          };
        }
        break;
      case 'sessionSnapshot':
        applySnapshot(p);
        break;
      case 'prependPage':
        applyPrependPage(p);
        break;
      case 'streamDelta':
        appendStreamDelta(p.kind, p.delta || '', p.html || '');
        break;
      case 'streamReset':
        state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '' };
        renderRows();
        break;
      case 'flagsUpdate':
        if (p.flags) {
          var nextFlags = {
            richText: !!p.flags.richText,
            showFullToolParams: !!p.flags.showFullToolParams,
            batchMode: !!p.flags.batchMode,
            menuDisabled: !!p.flags.menuDisabled,
          };
          if (flagsEqual(state.flags, nextFlags)) {
            break;
          }
          state.flags = nextFlags;
          if (state.flags.batchMode || state.flags.menuDisabled) {
            closeContextMenu(true);
          }
          renderRows();
        }
        break;
      case 'themeUpdate':
        applyTheme(p.theme);
        break;
      case 'selectionUpdate':
        state.selectedIds = (p.selectedMessageIds || []).slice();
        renderRows();
        break;
      case 'closeMenu':
        closeContextMenu(true);
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
    if (rows) {
      rows.addEventListener('click', onRowsClick);
      rows.addEventListener('touchstart', onMessagePointerDown, { passive: true });
      rows.addEventListener('touchend', onMessagePointerUp, { passive: true });
      rows.addEventListener('touchcancel', onMessagePointerUp, { passive: true });
    }
    post('ready', { version: 'm3' });
    state.ready = true;
  });
})();
`.trim();
}
