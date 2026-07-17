import {
  ANCHORED_MENU_GAP,
  ANCHORED_MENU_SCREEN_MARGIN,
  ANCHORED_MENU_ITEM_MIN_HEIGHT,
  ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT,
  ANCHORED_MENU_MAX_HEIGHT_CAP,
  ANCHORED_MENU_MIN_WIDTH,
  ANCHORED_MENU_MAX_WIDTH,
  ANCHORED_MENU_H_PADDING,
  ANCHORED_MENU_CHAR_WIDTH_EST,
  MENU_OPEN_GRACE_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
} from '@web/shared/constants';
import { state } from '../state/state';
import type {
  MenuAnchor,
  MenuItem,
  MessageRow,
  TranscriptRow,
  UserVfsTurnRow,
} from '../state/state';
import { post } from '../bridge/bridge';

/**
 * ISD 债/非债（菜单）：
 * - **债（已清）**：`#menu-backdrop` + `#context-menu` 的 createElement + body.appendChild / 裸 .remove()
 * - **非债（保留）**：layout / grace / menu-open / overlay 手势 / 长按
 * P0-3：完整 MenuOverlay 由 main 注册到 #menu-portal；本文件只持有实现引用，不 import ui / 不 preact.render。
 */
export type MenuOverlayViewProps = {
  messageId: string;
  items: MenuItem[];
  anchor: MenuAnchor;
};

/** null = 卸载（render(null, portal)）；非 null = 刷新完整 overlay。 */
export type RenderContextMenuView = (props: MenuOverlayViewProps | null) => void;

let _renderContextMenuView: RenderContextMenuView | null = null;

/** 由 main 注册 Preact MenuOverlay 刷新/卸载实现。 */
export function registerRenderContextMenu(fn: RenderContextMenuView): void {
  _renderContextMenuView = fn;
}

/**
 * 调用已注册实现；未注册时返回 false。
 */
export function invokeRegisteredRenderContextMenu(
  props: MenuOverlayViewProps | null,
): boolean {
  if (!_renderContextMenuView) return false;
  _renderContextMenuView(props);
  return true;
}

/**
 * 消息长按菜单：布局、打开/关闭与指针手势。
 */
export function computeContextMenuWidth(items: MenuItem[]): number {
  let longest = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].label.length > longest) longest = items[i].label.length;
  }
  const byLabel = longest * ANCHORED_MENU_CHAR_WIDTH_EST + ANCHORED_MENU_H_PADDING;
  const cap = window.innerWidth - ANCHORED_MENU_SCREEN_MARGIN * 2;
  return Math.min(
    cap,
    ANCHORED_MENU_MAX_WIDTH,
    Math.max(ANCHORED_MENU_MIN_WIDTH, byLabel),
  );
}

export function viewportHeight(): number {
  // position:fixed menus share the WebView layout viewport (not #scroller scroll box).
  const doc = document.documentElement;
  return doc.clientHeight || window.innerHeight;
}

export type ContextMenuLayout = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  scrollable: boolean;
};

export function layoutContextMenu(
  anchor: MenuAnchor,
  contentHeight: number,
  menuWidth: number,
): ContextMenuLayout {
  const screenW = window.innerWidth;
  const screenH = viewportHeight();
  const heightCap = Math.min(ANCHORED_MENU_MAX_HEIGHT_CAP, screenH * 0.45);
  const flipEstimate = Math.min(contentHeight, heightCap);
  const anchorCenterX = anchor.x + anchor.width / 2;
  let left = anchorCenterX - menuWidth / 2;
  left = Math.max(
    ANCHORED_MENU_SCREEN_MARGIN,
    Math.min(left, screenW - menuWidth - ANCHORED_MENU_SCREEN_MARGIN),
  );
  const spaceAbove = anchor.y;
  const spaceBelow = screenH - (anchor.y + anchor.height);
  // Prefer below; flip above when bottom space is too tight.
  const placeAbove =
    spaceBelow < flipEstimate + ANCHORED_MENU_GAP && spaceAbove >= spaceBelow;
  const availableSpace =
    (placeAbove ? spaceAbove : spaceBelow) -
    ANCHORED_MENU_GAP -
    ANCHORED_MENU_SCREEN_MARGIN;
  const availableMax = Math.max(ANCHORED_MENU_ITEM_MIN_HEIGHT, availableSpace);
  const scrollable = contentHeight > availableMax + 1;
  let menuHeight = scrollable
    ? Math.min(contentHeight, availableMax)
    : contentHeight;
  if (scrollable && menuHeight > heightCap) {
    menuHeight = heightCap;
  }
  let top: number;
  if (placeAbove) {
    top = anchor.y - menuHeight - ANCHORED_MENU_GAP;
  } else {
    top = anchor.y + anchor.height + ANCHORED_MENU_GAP;
  }
  top = Math.max(
    ANCHORED_MENU_SCREEN_MARGIN,
    Math.min(top, screenH - menuHeight - ANCHORED_MENU_SCREEN_MARGIN),
  );
  return {
    left: left,
    top: top,
    width: menuWidth,
    maxHeight: menuHeight,
    scrollable: scrollable,
  };
}

export function resolveMenuAnchor(
  messageId: string,
  clientX: number,
  clientY: number,
): MenuAnchor {
  // Long-press finger point (viewport coords); clamp Y inside bubble for tall messages.
  const touchH = ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT;
  let y = clientY - touchH * 0.5;
  const x = clientX;
  const rowEl = document.querySelector(
    '.row.message[data-id="' + messageId + '"]',
  );
  const boundsEl = rowEl
    ? (rowEl.querySelector('.bubble') as Element | null) || rowEl
    : null;
  if (boundsEl) {
    const rect = boundsEl.getBoundingClientRect();
    y = Math.max(rect.top, Math.min(y, rect.bottom - touchH));
  }
  return { x: x, y: y, width: 1, height: touchH };
}

export function findMessageRow(
  messageId: string,
): MessageRow | UserVfsTurnRow | null {
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i];
    if (
      (row.kind === 'message' || row.kind === 'user_vfs_turn') &&
      row.id === messageId
    ) {
      return row;
    }
  }
  return null;
}

export function buildMenuItems(
  row: TranscriptRow,
  hitEl: EventTarget | null,
): MenuItem[] {
  const items: MenuItem[] = [];
  if ('text' in row && row.text) items.push({ label: '编辑', action: 'edit' });
  items.push({ label: '复制', action: 'copy' });
  const hitElement = hitEl as Element | null;
  const showSetFloor =
    row.kind === 'message' &&
    row.role === 'user' &&
    !(hitElement && hitElement.closest && hitElement.closest('.tool-card, .tool-group-item'));
  if (showSetFloor) items.push({ label: '置位', action: 'set-floor' });
  items.push({ label: '分叉', action: 'fork' });
  if (!row.hidden) {
    items.push({ label: '回滚', action: 'rollback', danger: true });
  }
  return items;
}

export function suppressNativeTextMenu(event: Event): void {
  event.preventDefault();
}

export function attachMenuNativeTextBlock(): void {
  if (state.menuNativeTextBlockHandler) return;
  state.menuNativeTextBlockHandler = function (event: Event) {
    const menuEl = document.getElementById('context-menu');
    const backdrop = document.getElementById('menu-backdrop');
    const target = event.target as Element | null;
    if (!menuEl || !target || !target.closest) return;
    if (menuEl.contains(target) || (backdrop && backdrop.contains(target))) {
      suppressNativeTextMenu(event);
    }
  };
  document.addEventListener('contextmenu', state.menuNativeTextBlockHandler, true);
  document.addEventListener('selectstart', state.menuNativeTextBlockHandler, true);
}

export function detachMenuNativeTextBlock(): void {
  if (!state.menuNativeTextBlockHandler) return;
  document.removeEventListener(
    'contextmenu',
    state.menuNativeTextBlockHandler,
    true,
  );
  document.removeEventListener(
    'selectstart',
    state.menuNativeTextBlockHandler,
    true,
  );
  state.menuNativeTextBlockHandler = null;
  document.body.classList.remove('menu-open');
}

export function closeContextMenu(notifyHost?: boolean): void {
  if (!state.menu) return;
  state.menu = null;
  state.menuOpenedAt = 0;
  detachMenuNativeTextBlock();
  if (state.menuOverlayHandler) {
    document.removeEventListener('click', state.menuOverlayHandler, true);
    document.removeEventListener('touchend', state.menuOverlayHandler, true);
    state.menuOverlayHandler = null;
  }
  // 经注册卸载（render(null, #menu-portal)）；禁止裸 .remove() 甩掉 Preact 根
  if (_renderContextMenuView) {
    _renderContextMenuView(null);
  }
  if (notifyHost !== false) post('menuClosed', {});
}

export function handleMenuOverlayEvent(event: Event): void {
  if (!state.menu) return;
  const target = event.target as Element | null;
  if (!target || !target.closest) return;
  const menuEl = document.getElementById('context-menu');
  if (menuEl && menuEl.contains(target)) {
    const actionEl = target.closest('[data-action="menu-action"]');
    if (actionEl) {
      if (event.type === 'touchend') event.preventDefault();
      const messageId = actionEl.getAttribute('data-message-id');
      const menuAction = actionEl.getAttribute('data-menu-action');
      closeContextMenu(true);
      if (messageId && menuAction) {
        post('messageMenuAction', {
          messageId: messageId,
          action: menuAction,
        });
      }
    }
    return;
  }
  const rowEl = target.closest('.row.message');
  if (
    rowEl &&
    event.type === 'touchend' &&
    state.menuOpenedAt &&
    Date.now() - state.menuOpenedAt < MENU_OPEN_GRACE_MS
  ) {
    return;
  }
  // Backdrop lives on document.body outside #rows — capture dismiss here.
  closeContextMenu(true);
}

/**
 * 上下文菜单门面：已注册 MenuOverlay 刷新 + overlay 监听。
 * 壳 DOM 由 main → #menu-portal；P1-4 measure/layout 在 MenuOverlay useLayoutEffect。
 * 本函数不含 JSX / 不 createElement 挂 body。
 */
export function renderContextMenu(): void {
  if (!state.menu) return;
  if (!_renderContextMenuView) return;
  const menu = state.menu;
  _renderContextMenuView({
    messageId: menu.messageId,
    items: menu.items,
    anchor: menu.anchor,
  });
  document.body.classList.add('menu-open');
  attachMenuNativeTextBlock();
  state.menuOverlayHandler = handleMenuOverlayEvent;
  document.addEventListener('click', state.menuOverlayHandler, true);
  document.addEventListener('touchend', state.menuOverlayHandler, true);
}

export function openContextMenu(
  messageId: string,
  pageX: number,
  pageY: number,
  hitEl: EventTarget | null,
): void {
  if (state.flags.menuDisabled) return;
  const row = findMessageRow(messageId);
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

export function clearLongPress(): void {
  if (state.longPressTimer != null) {
    clearTimeout(state.longPressTimer);
    state.longPressTimer = null;
  }
  state.longPressTarget = null;
}

export function onMessagePointerDown(event: TouchEvent): void {
  if (state.flags.menuDisabled) return;
  const target = event.target as Element | null;
  const rowEl =
    target && target.closest ? target.closest('.row.message') : null;
  if (!rowEl) return;
  const messageId = rowEl.getAttribute('data-id');
  if (!messageId) return;
  const touch = event.touches && event.touches[0];
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
    const pressTarget = state.longPressTarget;
    state.longPressTarget = null;
    if (pressTarget) {
      openContextMenu(
        pressTarget.messageId,
        pressTarget.pageX,
        pressTarget.pageY,
        pressTarget.hitEl,
      );
    }
  }, 450);
}

export function shouldCancelLongPressForMove(
  deltaX: number,
  deltaY: number,
  tolerancePx?: number,
): boolean {
  if (tolerancePx == null) tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX;
  return Math.hypot(deltaX, deltaY) > tolerancePx;
}

export function onMessagePointerMove(event: TouchEvent): void {
  if (!state.longPressTarget) return;
  const touch = event.touches && event.touches[0];
  if (!touch) return;
  const dx = touch.clientX - state.longPressTarget.pageX;
  const dy = touch.clientY - state.longPressTarget.pageY;
  if (shouldCancelLongPressForMove(dx, dy, LONG_PRESS_MOVE_TOLERANCE_PX)) {
    clearLongPress();
  }
}

export function onMessagePointerUp(): void {
  clearLongPress();
}
