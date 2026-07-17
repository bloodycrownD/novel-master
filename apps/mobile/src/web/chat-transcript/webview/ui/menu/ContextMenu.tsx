/**
 * 上下文菜单结构：仅渲染菜单项按钮。
 * 布局 / overlay / 测量 / 开关由 runtime/menu 负责（P0-3 / P1-4）。
 */
import type { MenuItem } from '../../runtime/state/state';

export type ContextMenuProps = {
  messageId: string;
  items: MenuItem[];
};

export function ContextMenu({ messageId, items }: ContextMenuProps) {
  return items.map((item) => (
    <button
      type="button"
      key={item.action}
      className={'menu-item' + (item.danger ? ' danger' : '')}
      data-action="menu-action"
      data-message-id={messageId}
      data-menu-action={item.action}
    >
      {item.label}
    </button>
  ));
}
