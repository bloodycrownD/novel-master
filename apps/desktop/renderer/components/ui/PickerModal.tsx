type PickerRow = {
  readonly id: string;
  readonly label: string;
};

type PickerModalProps = {
  open: boolean;
  title: string;
  rows: readonly PickerRow[];
  onClose: () => void;
  onSelect: (id: string) => void;
};

export function PickerModal({
  open,
  title,
  rows,
  onClose,
  onSelect,
}: PickerModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal text-prompt-modal--wide picker-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-prompt-modal__title">{title}</h3>
        <ul className="picker-modal__list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="picker-modal__item"
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
        <div className="text-prompt-modal__actions">
          <button type="button" className="text-prompt-modal__btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
