type PickerRow = {
  readonly id: string;
  readonly label: string;
};

type PickerModalProps = {
  open: boolean;
  title: string;
  rows: readonly PickerRow[];
  onClose: () => void;
  onSelect: (id: string | null) => void;
  currentId?: string | null;
  allowNone?: boolean;
  noneLabel?: string;
};

export function PickerModal({
  open,
  title,
  rows,
  onClose,
  onSelect,
  currentId,
  allowNone,
  noneLabel = "不启用",
}: PickerModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="picker-modal">
      <div className="picker-modal__backdrop" onClick={onClose} />
      <div className="picker-modal__panel" role="dialog" aria-modal="true">
        <h3 className="picker-modal__title">{title}</h3>
        <ul className="picker-modal__list">
          {allowNone ? (
            <li>
              <button
                type="button"
                className={`picker-modal__item${currentId == null ? " is-selected" : ""}`}
                onClick={() => {
                  onSelect(null);
                  onClose();
                }}
              >
                {noneLabel}
              </button>
            </li>
          ) : null}
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`picker-modal__item${row.id === currentId ? " is-selected" : ""}`}
                onClick={() => {
                  onSelect(row.id);
                  onClose();
                }}
              >
                {row.label}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="picker-modal__cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
