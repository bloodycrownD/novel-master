/**
 * WebView transcript boot script (IIFE) — mirrors scroll.ts semantics in the WebView.
 * Bundled into CHAT_TRANSCRIPT_HTML; keep nearBottom threshold in sync with scroll.ts.
 */
import {
  LONG_PRESS_MOVE_TOLERANCE_PX,
  MENU_OPEN_GRACE_MS,
  shouldCancelLongPressForMove,
} from './menu-overlay-guards';
import {NEAR_BOTTOM_THRESHOLD_PX} from './scroll';
import {
  ANCHORED_MENU_CHAR_WIDTH_EST,
  ANCHORED_MENU_GAP,
  ANCHORED_MENU_H_PADDING,
  ANCHORED_MENU_ITEM_LAYOUT_HEIGHT,
  ANCHORED_MENU_ITEM_MIN_HEIGHT,
  ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT,
  MESSAGE_ACTION_MENU_ITEM_COUNT,
  ANCHORED_MENU_MAX_HEIGHT_CAP,
  ANCHORED_MENU_MAX_WIDTH,
  ANCHORED_MENU_MIN_WIDTH,
  ANCHORED_MENU_SCREEN_MARGIN,
} from '../../components/chat/anchored-menu-layout';
import {DECODE_LITERAL_HTML_ENTITIES_BOOT} from '../../components/rich-content/decode-literal-html-entities';

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
    flags: { richText: false, batchMode: false, menuDisabled: false },
    selectedIds: [],
    menu: null,
    menuOverlayHandler: null,
    menuNativeTextBlockHandler: null,
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

  /** Tail shrink (rollback): prevScrollTop may exceed new max — clamp to avoid bubble jump. */
  function clampScrollTop(el, prevScrollTop) {
    var maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(prevScrollTop, maxScroll);
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
    if (state.longPressTimer != null || state.longPressTarget != null) {
      clearLongPress();
    }
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
    return escapeHtmlRaw(decodeLiteralHtmlEntities(s));
  }

  function escapeHtmlRaw(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  ${DECODE_LITERAL_HTML_ENTITIES_BOOT}

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

  function thinkingBodyInner(text, thinkingHtml) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if (state.flags.richText && thinkingHtml) {
      return thinkingHtml;
    }
    return escapeHtml(trimmed);
  }

  function renderThinkingSection(text, key, expanded, thinkingHtml, showDividerBelow) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return '';
    var chevron = expanded ? '▼' : '▶';
    var richClass = state.flags.richText && thinkingHtml ? ' rich' : '';
    var bodyClass = 'thinking-body' + richClass;
    if (expanded && showDividerBelow) {
      bodyClass += ' thinking-body-divided';
    }
    var body = expanded
      ? '<div class="' + bodyClass + '">' + thinkingBodyInner(text, thinkingHtml) + '</div>'
      : '';
    return (
      '<div class="thinking-section" data-thinking-key="' + escapeHtml(key) + '">' +
      '<div class="thinking-header" data-action="toggle-thinking" data-thinking-key="' + escapeHtml(key) + '">' +
      '<span class="thinking-title">思考过程</span>' +
      '<span class="thinking-chevron">' + chevron + '</span></div>' + body + '</div>'
    );
  }

  function renderAssistantBubbleInner(text, textHtml, thinking, thinkingKey, thinkingExpanded, thinkingHtml) {
    var html = '';
    var hasThinking = !!(thinking && String(thinking).trim());
    var hasText = !!(text && String(text).trim());
    if (hasThinking) {
      html += renderThinkingSection(
        thinking,
        thinkingKey,
        thinkingExpanded,
        thinkingHtml,
        hasText
      );
    }
    if (hasText) {
      var richBubble = state.flags.richText && textHtml ? ' rich' : '';
      var inner = textHtml || escapeHtml(text || '');
      html += '<div class="bubble-body' + richBubble + '">' + inner + '</div>';
    }
    return html;
  }

  function renderToolRow(row) {
    var filePath = vfsToolFilePath(row.name, row.input || {});
    var canOpen = filePath != null;
    var summary = escapeHtml(toolCallSummary(row));
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
      html += '<div class="tool-open-hint">点击查看 · 聊天工作区</div>';
    }
    html += '</div></div>';
    return html;
  }

  function computeContextMenuWidth(items) {
    var longest = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].label.length > longest) longest = items[i].label.length;
    }
    var byLabel = longest * ${ANCHORED_MENU_CHAR_WIDTH_EST} + ${ANCHORED_MENU_H_PADDING};
    var cap = window.innerWidth - ${ANCHORED_MENU_SCREEN_MARGIN} * 2;
    return Math.min(cap, ${ANCHORED_MENU_MAX_WIDTH}, Math.max(${ANCHORED_MENU_MIN_WIDTH}, byLabel));
  }

  function viewportHeight() {
    // position:fixed menus share the WebView layout viewport (not #scroller scroll box).
    var doc = document.documentElement;
    return doc.clientHeight || window.innerHeight;
  }

  function layoutContextMenu(anchor, contentHeight, menuWidth) {
    var screenW = window.innerWidth;
    var screenH = viewportHeight();
    var heightCap = Math.min(${ANCHORED_MENU_MAX_HEIGHT_CAP}, screenH * 0.45);
    var flipEstimate = Math.min(contentHeight, heightCap);
    var anchorCenterX = anchor.x + anchor.width / 2;
    var left = anchorCenterX - menuWidth / 2;
    left = Math.max(${ANCHORED_MENU_SCREEN_MARGIN}, Math.min(left, screenW - menuWidth - ${ANCHORED_MENU_SCREEN_MARGIN}));
    var spaceAbove = anchor.y;
    var spaceBelow = screenH - (anchor.y + anchor.height);
    // Prefer below; flip above when bottom space is too tight.
    var placeAbove = spaceBelow < flipEstimate + ${ANCHORED_MENU_GAP} && spaceAbove >= spaceBelow;
    var availableSpace = (placeAbove ? spaceAbove : spaceBelow) - ${ANCHORED_MENU_GAP} - ${ANCHORED_MENU_SCREEN_MARGIN};
    var availableMax = Math.max(${ANCHORED_MENU_ITEM_MIN_HEIGHT}, availableSpace);
    var scrollable = contentHeight > availableMax + 1;
    var menuHeight = scrollable ? Math.min(contentHeight, availableMax) : contentHeight;
    if (scrollable && menuHeight > heightCap) {
      menuHeight = heightCap;
    }
    var top = placeAbove
      ? anchor.y - menuHeight - ${ANCHORED_MENU_GAP}
      : anchor.y + anchor.height + ${ANCHORED_MENU_GAP};
    top = Math.max(${ANCHORED_MENU_SCREEN_MARGIN}, Math.min(top, screenH - menuHeight - ${ANCHORED_MENU_SCREEN_MARGIN}));
    return { left: left, top: top, width: menuWidth, maxHeight: menuHeight, scrollable: scrollable };
  }

  function resolveMenuAnchor(messageId, clientX, clientY) {
    // Long-press finger point (viewport coords); clamp Y inside bubble for tall messages.
    var touchH = ${ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT};
    var y = clientY - touchH * 0.5;
    var x = clientX;
    var rowEl = document.querySelector('.row.message[data-id="' + messageId + '"]');
    var boundsEl = rowEl ? (rowEl.querySelector('.bubble') || rowEl) : null;
    if (boundsEl) {
      var rect = boundsEl.getBoundingClientRect();
      y = Math.max(rect.top, Math.min(y, rect.bottom - touchH));
    }
    return { x: x, y: y, width: 1, height: touchH };
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

  function suppressNativeTextMenu(event) {
    event.preventDefault();
  }

  function attachMenuNativeTextBlock() {
    if (state.menuNativeTextBlockHandler) return;
    state.menuNativeTextBlockHandler = function (event) {
      var menuEl = document.getElementById('context-menu');
      var backdrop = document.getElementById('menu-backdrop');
      var target = event.target;
      if (!menuEl || !target || !target.closest) return;
      if (menuEl.contains(target) || (backdrop && backdrop.contains(target))) {
        suppressNativeTextMenu(event);
      }
    };
    document.addEventListener('contextmenu', state.menuNativeTextBlockHandler, true);
    document.addEventListener('selectstart', state.menuNativeTextBlockHandler, true);
  }

  function detachMenuNativeTextBlock() {
    if (!state.menuNativeTextBlockHandler) return;
    document.removeEventListener('contextmenu', state.menuNativeTextBlockHandler, true);
    document.removeEventListener('selectstart', state.menuNativeTextBlockHandler, true);
    state.menuNativeTextBlockHandler = null;
    document.body.classList.remove('menu-open');
  }

  function closeContextMenu(notifyHost) {
    if (!state.menu) return;
    state.menu = null;
    state.menuOpenedAt = 0;
    detachMenuNativeTextBlock();
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
    var menuWidth = computeContextMenuWidth(menu.items);
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
    // Measure rendered rows (CSS min-height + borders); estimate 48px/row overshoots on device.
    menuEl.style.position = 'fixed';
    menuEl.style.visibility = 'hidden';
    menuEl.style.left = '0';
    menuEl.style.top = '0';
    menuEl.style.width = menuWidth + 'px';
    menuEl.style.maxHeight = 'none';
    var measuredHeight = menuEl.offsetHeight || menuEl.scrollHeight;
    var contentHeight = measuredHeight > 0
      ? measuredHeight
      : menu.items.length * ${ANCHORED_MENU_ITEM_LAYOUT_HEIGHT};
    var layout = layoutContextMenu(menu.anchor, contentHeight, menuWidth);
    if (menu.items.length <= ${MESSAGE_ACTION_MENU_ITEM_COUNT}) {
      layout = {
        left: layout.left,
        top: layout.top,
        width: layout.width,
        maxHeight: contentHeight,
        scrollable: false,
      };
    }
    menuEl.style.visibility = '';
    menuEl.style.left = layout.left + 'px';
    menuEl.style.top = layout.top + 'px';
    menuEl.style.width = layout.width + 'px';
    menuEl.style.height = 'auto';
    if (layout.scrollable) {
      menuEl.className = 'context-menu scrollable';
      menuEl.style.maxHeight = layout.maxHeight + 'px';
    } else {
      menuEl.className = 'context-menu';
      menuEl.style.maxHeight = 'none';
    }
    document.body.classList.add('menu-open');
    attachMenuNativeTextBlock();
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
      anchor: resolveMenuAnchor(messageId, pageX, pageY),
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
    state.longPressTarget = {
      messageId: messageId,
      pageX: touch.clientX,
      pageY: touch.clientY,
    };
    state.longPressTimer = setTimeout(function () {
      state.longPressTimer = null;
      var target = state.longPressTarget;
      state.longPressTarget = null;
      if (target) openContextMenu(target.messageId, target.pageX, target.pageY);
    }, 450);
  }

  function onMessagePointerMove(event) {
    if (!state.longPressTarget) return;
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    var dx = touch.clientX - state.longPressTarget.pageX;
    var dy = touch.clientY - state.longPressTarget.pageY;
    if (shouldCancelLongPressForMove(dx, dy, ${LONG_PRESS_MOVE_TOLERANCE_PX})) {
      clearLongPress();
    }
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
    var selected = isSelected(row.id);
    var selectedClass = selected ? ' selected' : '';
    var html = '';
    if (state.flags.batchMode) {
      html += '<div class="batch-row" data-action="toggle-select" data-id="' + escapeHtml(row.id) + '"><div class="batch-check' + (selected ? ' checked' : '') +
        '" aria-hidden="true">' +
        (selected ? '✓' : '') + '</div><div class="batch-content">';
    }
    html += '<div class="row message ' + role + hidden + selectedClass + '" data-id="' + escapeHtml(row.id) + '">';
    if (role === 'user') {
      if (row.text) {
        html += '<div class="bubble">' + escapeHtml(row.text) + '</div>';
      }
    } else if (row.thinking || row.text) {
      var richBubble = state.flags.richText && row.textHtml ? ' rich' : '';
      html += '<div class="bubble' + richBubble + '">' +
        renderAssistantBubbleInner(
          row.text,
          row.textHtml,
          row.thinking,
          thinkingKey,
          thinkingExpanded,
          row.thinkingHtml
        ) +
        '</div>';
    }
    html += '</div>';
    if (state.flags.batchMode) {
      html += '</div></div>';
    }
    return html;
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

  function renderStreamBubbleInner() {
    return renderAssistantBubbleInner(
      state.stream.text,
      state.stream.textHtml,
      state.stream.thinking,
      'stream:thinking',
      true,
      streamThinkingHtml()
    );
  }

  function updateStreamBubble(tail) {
    var bubble = tail.querySelector('.bubble');
    var richClass = streamBubbleRichClass();
    var inner = renderStreamBubbleInner();
    if (!inner) return;
    if (bubble) {
      bubble.className = 'bubble assistant' + richClass;
      bubble.innerHTML = inner;
      return;
    }
    var el = document.createElement('div');
    el.className = 'bubble assistant' + richClass;
    el.innerHTML = inner;
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
    if (state.stream.thinking || state.stream.text) {
      html += '<div class="row stream" id="stream-tail"><div class="bubble assistant' +
        streamBubbleRichClass() + '">' + renderStreamBubbleInner() + '</div></div>';
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
        clampScrollTop(scroller, prevScrollTop);
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
      updateStreamBubble(tail);
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
            batchMode: !!p.flags.batchMode,
            menuDisabled: !!p.flags.menuDisabled,
          };
          if (flagsEqual(state.flags, nextFlags)) {
            break;
          }
          var richToggledOn = !state.flags.richText && nextFlags.richText;
          state.flags = nextFlags;
          if (state.flags.batchMode || state.flags.menuDisabled) {
            closeContextMenu(true);
          }
          // Rich on: wait for sessionSnapshot rows with textHtml (avoid escapeHtml fallback).
          if (!richToggledOn) {
            renderRows();
          }
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
      rows.addEventListener('touchmove', onMessagePointerMove, { passive: true });
      rows.addEventListener('touchend', onMessagePointerUp, { passive: true });
      rows.addEventListener('touchcancel', onMessagePointerUp, { passive: true });
    }
    post('ready', { version: 'm3' });
    state.ready = true;
  });
})();
`.trim();
}
