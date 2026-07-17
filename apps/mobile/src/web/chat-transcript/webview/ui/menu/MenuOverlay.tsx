/**
 * 上下文菜单完整 overlay：backdrop + #context-menu 容器 + 菜单项。
 * P1-4：初始 visibility:hidden → useLayoutEffect 内 measure + layoutContextMenu → 可见
 * （禁止先可见再跳位）。挂载由 main `render` 到 `#menu-portal`（Portal 等价）。
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  ANCHORED_MENU_ITEM_LAYOUT_HEIGHT,
  MESSAGE_ACTION_MENU_ITEM_COUNT,
} from '@web/shared/constants';
import type { MenuAnchor, MenuItem } from '../../runtime/state/state';
import {
  computeContextMenuWidth,
  layoutContextMenu,
} from '../../runtime/menu/menu';
import { ContextMenu } from './ContextMenu';

export type MenuOverlayProps = {
  messageId: string;
  items: MenuItem[];
  anchor: MenuAnchor;
};

export function MenuOverlay({ messageId, items, anchor }: MenuOverlayProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuWidth = computeContextMenuWidth(items);

  useLayoutEffect(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;

    // P1-4：mount 后、对用户可见前完成 measure + layoutContextMenu
    menuEl.style.position = 'fixed';
    menuEl.style.visibility = 'hidden';
    menuEl.style.left = '0';
    menuEl.style.top = '0';
    menuEl.style.width = menuWidth + 'px';
    menuEl.style.maxHeight = 'none';

    // 测量已渲染行高（CSS min-height + borders）；估算在真机易偏大
    const measuredHeight = menuEl.offsetHeight || menuEl.scrollHeight;
    const contentHeight =
      measuredHeight > 0
        ? measuredHeight
        : items.length * ANCHORED_MENU_ITEM_LAYOUT_HEIGHT;
    let layout = layoutContextMenu(anchor, contentHeight, menuWidth);
    if (items.length <= MESSAGE_ACTION_MENU_ITEM_COUNT) {
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
  }, [messageId, items, anchor, menuWidth]);

  return (
    <>
      <div
        id="menu-backdrop"
        className="menu-backdrop"
        data-action="close-menu"
      />
      <div
        ref={menuRef}
        id="context-menu"
        className="context-menu"
        style={{
          position: 'fixed',
          visibility: 'hidden',
          left: '0',
          top: '0',
          width: menuWidth + 'px',
          maxHeight: 'none',
        }}
      >
        <ContextMenu messageId={messageId} items={items} />
      </div>
    </>
  );
}
