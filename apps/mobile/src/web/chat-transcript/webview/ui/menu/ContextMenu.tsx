/**
 * 上下文菜单项按钮列表。
 * 完整 overlay（backdrop + 容器 + 定位）见 MenuOverlay；开关 / grace / overlay 手势由 runtime/menu 负责。
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
