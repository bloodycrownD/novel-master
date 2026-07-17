/**
 * 上下文菜单完整 overlay：backdrop + #context-menu 容器 + 菜单项。
 * P1-4：初始 visibility:hidden → useLayoutEffect 内只读 measure → setState 驱动
 * 最终 style/className → 可见（禁止 effect 内长期命令式双写 DOM；禁止先可见再跳位）。
 * 挂载由 main `render` 到 `#menu-portal`（Portal 等价）。
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  ANCHORED_MENU_ITEM_LAYOUT_HEIGHT,
  MESSAGE_ACTION_MENU_ITEM_COUNT,
} from '@web/shared/constants';
import type { MenuAnchor, MenuItem } from '../../runtime/state/state';
import {
  computeContextMenuWidth,
  layoutContextMenu,
  type ContextMenuLayout,
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
  /** null = 仍隐藏待测；非 null = 已定位，由 state 驱动最终 style/className */
  const [layout, setLayout] = useState<ContextMenuLayout | null>(null);

  // 输入变更：先回到隐藏，同帧后续 effect 再 measure（避免带着旧坐标测）
  useLayoutEffect(() => {
    setLayout(null);
  }, [messageId, items, anchor, menuWidth]);

  useLayoutEffect(() => {
    if (layout !== null) return;
    const menuEl = menuRef.current;
    if (!menuEl) return;

    // 只读 measure；结果经 setLayout，不写 menuEl.style / className
    const measuredHeight = menuEl.offsetHeight || menuEl.scrollHeight;
    const contentHeight =
      measuredHeight > 0
        ? measuredHeight
        : items.length * ANCHORED_MENU_ITEM_LAYOUT_HEIGHT;
    let next = layoutContextMenu(anchor, contentHeight, menuWidth);
    if (items.length <= MESSAGE_ACTION_MENU_ITEM_COUNT) {
      next = {
        left: next.left,
        top: next.top,
        width: next.width,
        maxHeight: contentHeight,
        scrollable: false,
      };
    }
    setLayout(next);
  }, [layout, messageId, items, anchor, menuWidth]);

  const placed = layout !== null;
  const className =
    placed && layout.scrollable ? 'context-menu scrollable' : 'context-menu';
  const style = placed
    ? {
        position: 'fixed' as const,
        left: layout.left + 'px',
        top: layout.top + 'px',
        width: layout.width + 'px',
        height: 'auto',
        maxHeight: layout.scrollable ? layout.maxHeight + 'px' : 'none',
        visibility: 'visible' as const,
      }
    : {
        position: 'fixed' as const,
        visibility: 'hidden' as const,
        left: '0',
        top: '0',
        width: menuWidth + 'px',
        maxHeight: 'none',
      };

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
        className={className}
        style={style}
      >
        <ContextMenu messageId={messageId} items={items} />
      </div>
    </>
  );
}
