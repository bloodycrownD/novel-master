import { useEffect, useState } from "react";
import { handleSingleLineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";

type AddModelModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (vendorModelId: string, displayName?: string) => void | Promise<void>;
};

export function AddModelModal({ open, onClose, onConfirm }: AddModelModalProps) {
  const [vendorModelId, setVendorModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setVendorModelId("");
      setDisplayName("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const vendor = vendorModelId.trim();
  const canSubmit = vendor.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    try {
      const label = displayName.trim() || undefined;
      await onConfirm(vendor, label);
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
        aria-labelledby="add-model-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="add-model-title" className="text-prompt-modal__title">
          添加模型
        </h3>
        <p className="text-prompt-modal__label">厂商模型 ID</p>
        <input
          className="text-prompt-modal__input"
          type="text"
          value={vendorModelId}
          onChange={(e) => setVendorModelId(e.target.value)}
          placeholder="如 gpt-4o"
          autoFocus
          onKeyDown={(e) => {
            handleSingleLineSubmitKeyDown(e, () => {
              if (canSubmit) {
                void handleConfirm();
              }
            });
          }}
        />
        <p className="text-prompt-modal__label">显示名称（可选）</p>
        <input
          className="text-prompt-modal__input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="留空则使用厂商 ID"
          onKeyDown={(e) => {
            handleSingleLineSubmitKeyDown(e, () => {
              if (canSubmit) {
                void handleConfirm();
              }
            });
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
            {saving ? "添加中…" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}
