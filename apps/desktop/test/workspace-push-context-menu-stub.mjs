/**
 * ContextMenu 的测试替身（workspace-push 菜单测试用）：
 * 避开 createPortal（react-test-renderer 无真实 DOM 容器），
 * items 直接渲染成普通按钮树；点击行为与真实组件一致（onClose + onSelect）。
 * 菜单可见性/确认流的断言对象是 WorkspaceHeaderActions 的菜单构造，
 * ContextMenu 自身渲染不在本测试范围。
 */
import { createElement } from "react";

export function ContextMenu({ open, items, onSelect, onClose }) {
  if (!open) {
    return null;
  }
  return createElement(
    "div",
    { className: "context-menu-stub", role: "menu" },
    items.map((item) =>
      createElement(
        "button",
        {
          key: item.action,
          type: "button",
          role: "menuitem",
          className: item.danger ? "is-danger" : undefined,
          onClick: () => {
            onClose();
            onSelect(item.action);
          },
        },
        item.label,
      ),
    ),
  );
}
