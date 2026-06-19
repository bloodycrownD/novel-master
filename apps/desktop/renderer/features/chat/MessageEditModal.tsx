import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";

type MessageEditModalProps = {
  open: boolean;
  title: string;
  initialValue?: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
};

export function MessageEditModal({
  open,
  title,
  initialValue = "",
  onClose,
  onConfirm,
}: MessageEditModalProps) {
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
        className="text-prompt-modal text-prompt-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="message-edit-title" className="text-prompt-modal__title">
          {title}
        </h3>
        <TextArea
          code
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          rows={8}
        />
        <div className="text-prompt-modal__actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
