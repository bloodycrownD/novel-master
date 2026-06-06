import { useEffect } from "react";

export type ContextMenuItem = {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
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
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocClick = () => onClose();
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className={item.danger ? "is-danger" : undefined}
          onClick={() => {
            onClose();
            onSelect(item.action);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
