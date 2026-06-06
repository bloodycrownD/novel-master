import { useEffect, useState } from "react";

type TextPromptModalProps = {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
};

export function TextPromptModal({
  open,
  title,
  label,
  placeholder,
  initialValue = "",
  confirmLabel = "确定",
  onClose,
  onConfirm,
}: TextPromptModalProps) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [open, initialValue]);

  if (!open) {
    return null;
  }

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-prompt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="text-prompt-title" className="text-prompt-modal__title">
          {title}
        </h3>
        {label ? <p className="text-prompt-modal__label">{label}</p> : null}
        <input
          className="text-prompt-modal__input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) {
              void handleConfirm();
            }
          }}
        />
        <div className="text-prompt-modal__actions">
          <button type="button" className="text-prompt-modal__btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="text-prompt-modal__btn text-prompt-modal__btn--primary"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {saving ? "保存中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
