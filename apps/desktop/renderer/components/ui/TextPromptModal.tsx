import { useEffect, useState } from "react";
import { handleSingleLineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";

type TextPromptModalProps = {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  /**
   * 提交前对原始输入（未 trim）的校验：返回错误文案则行内展示并禁用提交。
   * 不传则维持历史行为（trim 后非空即可提交）。
   */
  validate?: (rawValue: string) => string | null;
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
  validate,
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
  const validationError = validate ? validate(value) : null;
  const canSubmit = trimmed.length > 0 && validationError == null && !saving;

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
            handleSingleLineSubmitKeyDown(e, () => {
              if (canSubmit) {
                void handleConfirm();
              }
            });
          }}
        />
        {validationError ? (
          <p className="text-prompt-modal__error" role="alert">
            {validationError}
          </p>
        ) : null}
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
