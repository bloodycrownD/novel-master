import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
  /** 禁用项（不可点；悬停提示由 title 提供）。 */
  readonly disabled?: boolean;
};

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onSelect: (action: string) => void;
  onClose: () => void;
};

export function ContextMenu({
  open,
  x,
  y,
  items,
  onSelect,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocPointer = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDocPointer);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDocPointer);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className={item.danger ? "is-danger" : undefined}
          disabled={item.disabled === true}
          onClick={() => {
            onClose();
            if (item.disabled !== true) {
              onSelect(item.action);
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
