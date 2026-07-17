// @ts-nocheck
import {
  ANCHORED_MENU_GAP,
  ANCHORED_MENU_SCREEN_MARGIN,
  ANCHORED_MENU_ITEM_MIN_HEIGHT,
  ANCHORED_MENU_ITEM_LAYOUT_HEIGHT,
  ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT,
  ANCHORED_MENU_MAX_HEIGHT_CAP,
  ANCHORED_MENU_MIN_WIDTH,
  ANCHORED_MENU_MAX_WIDTH,
  ANCHORED_MENU_H_PADDING,
  ANCHORED_MENU_CHAR_WIDTH_EST,
  MESSAGE_ACTION_MENU_ITEM_COUNT,
  MENU_OPEN_GRACE_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
} from '../../shared/constants';
import { escapeHtml } from './html-escape';
import { state } from './state';
import { post } from './bridge';
/**
 * 消息长按菜单：布局、打开/关闭与指针手势。
 */
export function computeContextMenuWidth(items) {
    var longest = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].label.length > longest) longest = items[i].label.length;
    }
    var byLabel = longest * ANCHORED_MENU_CHAR_WIDTH_EST + ANCHORED_MENU_H_PADDING;
    var cap = window.innerWidth - ANCHORED_MENU_SCREEN_MARGIN * 2;
    return Math.min(cap, ANCHORED_MENU_MAX_WIDTH, Math.max(ANCHORED_MENU_MIN_WIDTH, byLabel));
  }

export function viewportHeight() {
    // position:fixed menus share the WebView layout viewport (not #scroller scroll box).
    var doc = document.documentElement;
    return doc.clientHeight || window.innerHeight;
  }

export function layoutContextMenu(anchor, contentHeight, menuWidth) {
    var screenW = window.innerWidth;
    var screenH = viewportHeight();
    var heightCap = Math.min(ANCHORED_MENU_MAX_HEIGHT_CAP, screenH * 0.45);
    var flipEstimate = Math.min(contentHeight, heightCap);
    var anchorCenterX = anchor.x + anchor.width / 2;
    var left = anchorCenterX - menuWidth / 2;
    left = Math.max(ANCHORED_MENU_SCREEN_MARGIN, Math.min(left, screenW - menuWidth - ANCHORED_MENU_SCREEN_MARGIN));
    var spaceAbove = anchor.y;
    var spaceBelow = screenH - (anchor.y + anchor.height);
    // Prefer below; flip above when bottom space is too tight.
    var placeAbove = spaceBelow < flipEstimate + ANCHORED_MENU_GAP && spaceAbove >= spaceBelow;
    var availableSpace = (placeAbove ? spaceAbove : spaceBelow) - ANCHORED_MENU_GAP - ANCHORED_MENU_SCREEN_MARGIN;
    var availableMax = Math.max(ANCHORED_MENU_ITEM_MIN_HEIGHT, availableSpace);
    var scrollable = contentHeight > availableMax + 1;
    var menuHeight = scrollable ? Math.min(contentHeight, availableMax) : contentHeight;
    if (scrollable && menuHeight > heightCap) {
      menuHeight = heightCap;
    }
    var top = placeAbove
      ? anchor.y - menuHeight - ANCHORED_MENU_GAP
      : anchor.y + anchor.height + ANCHORED_MENU_GAP;
    top = Math.max(ANCHORED_MENU_SCREEN_MARGIN, Math.min(top, screenH - menuHeight - ANCHORED_MENU_SCREEN_MARGIN));
    return { left: left, top: top, width: menuWidth, maxHeight: menuHeight, scrollable: scrollable };
  }

export function resolveMenuAnchor(messageId, clientX, clientY) {
    // Long-press finger point (viewport coords); clamp Y inside bubble for tall messages.
    var touchH = ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT;
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

export function findMessageRow(messageId) {
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if ((row.kind === 'message' || row.kind === 'user_vfs_turn') && row.id === messageId) {
        return row;
      }
    }
    return null;
  }

export function buildMenuItems(row, hitEl) {
    var items = [];
    if (row.text) items.push({ label: '编辑', action: 'edit' });
    items.push({ label: '复制', action: 'copy' });
    var showSetFloor = row.kind === 'message' &&
      row.role === 'user' &&
      !(hitEl && hitEl.closest && hitEl.closest('.tool-card, .tool-group-item'));
    if (showSetFloor) items.push({ label: '置位', action: 'set-floor' });
    items.push({ label: '分叉', action: 'fork' });
    if (!row.hidden) {
      items.push({ label: '回滚', action: 'rollback', danger: true });
    }
    return items;
  }

export function suppressNativeTextMenu(event) {
    event.preventDefault();
  }

export function attachMenuNativeTextBlock() {
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

export function detachMenuNativeTextBlock() {
    if (!state.menuNativeTextBlockHandler) return;
    document.removeEventListener('contextmenu', state.menuNativeTextBlockHandler, true);
    document.removeEventListener('selectstart', state.menuNativeTextBlockHandler, true);
    state.menuNativeTextBlockHandler = null;
    document.body.classList.remove('menu-open');
  }

export function closeContextMenu(notifyHost) {
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

export function handleMenuOverlayEvent(event) {
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

export function renderContextMenu() {
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
      : menu.items.length * ANCHORED_MENU_ITEM_LAYOUT_HEIGHT;
    var layout = layoutContextMenu(menu.anchor, contentHeight, menuWidth);
    if (menu.items.length <= MESSAGE_ACTION_MENU_ITEM_COUNT) {
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

export function openContextMenu(messageId, pageX, pageY, hitEl) {
    if (state.flags.menuDisabled) return;
    var row = findMessageRow(messageId);
    if (!row) return;
    post('openMessageMenu', { messageId: messageId, pageX: pageX, pageY: pageY });
    post('menuOpened', {});
    state.menu = {
      messageId: messageId,
      pageX: pageX,
      pageY: pageY,
      anchor: resolveMenuAnchor(messageId, pageX, pageY),
      items: buildMenuItems(row, hitEl),
    };
    state.menuOpenedAt = Date.now();
    renderContextMenu();
  }

export function clearLongPress() {
    if (state.longPressTimer != null) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
    state.longPressTarget = null;
  }

export function onMessagePointerDown(event) {
    if (state.flags.menuDisabled) return;
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
      hitEl: event.target,
    };
    state.longPressTimer = setTimeout(function () {
      state.longPressTimer = null;
      var target = state.longPressTarget;
      state.longPressTarget = null;
      if (target) openContextMenu(target.messageId, target.pageX, target.pageY, target.hitEl);
    }, 450);
  }

  
export function shouldCancelLongPressForMove(deltaX, deltaY, tolerancePx) {
    if (tolerancePx == null) tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX;
    return Math.hypot(deltaX, deltaY) > tolerancePx;
  }

export function onMessagePointerMove(event) {
    if (!state.longPressTarget) return;
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    var dx = touch.clientX - state.longPressTarget.pageX;
    var dy = touch.clientY - state.longPressTarget.pageY;
    if (shouldCancelLongPressForMove(dx, dy, LONG_PRESS_MOVE_TOLERANCE_PX)) {
      clearLongPress();
    }
  }

export function onMessagePointerUp() {
    clearLongPress();
  }
