import { useEffect, useState } from "react";
import { coreT } from "@shared/logic/core-i18n";
import { handleSingleLineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";

type AddModelModalProps = {
    open: boolean;
    onClose: () => void;
    onConfirm: (vendorModelId: string, modelName?: string) => void | Promise<void>;
};

export function AddModelModal({ open, onClose, onConfirm }: AddModelModalProps) {
    const [vendorModelId, setVendorModelId] = useState("");
    const [modelName, setModelName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setVendorModelId("");
            setModelName("");
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
            const label = modelName.trim() || undefined;
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
                    {coreT({key: "ui.provider.add_model_title"})}
                </h3>
                <p className="text-prompt-modal__label">{coreT({key: "ui.provider.vendor_model_id_label"})}</p>
                <input
                    className="text-prompt-modal__input"
                    type="text"
                    value={vendorModelId}
                    onChange={(e) => setVendorModelId(e.target.value)}
                    placeholder={coreT({key: "ui.provider.vendor_model_id_placeholder"})}
                    autoFocus
                    onKeyDown={(e) => {
                        handleSingleLineSubmitKeyDown(e, () => {
                            if (canSubmit) {
                                void handleConfirm();
                            }
                        });
                    }}
                />
                <p className="text-prompt-modal__label">{coreT({key: "ui.provider.model_name_optional_label"})}</p>
                <input
                    className="text-prompt-modal__input"
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder={coreT({key: "ui.provider.model_name_keep_hint"})}
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
                        {coreT({key: "ui.common.cancel"})}
                    </button>
                    <button
                        type="button"
                        className="text-prompt-modal__btn text-prompt-modal__btn--primary"
                        disabled={!canSubmit}
                        onClick={() => void handleConfirm()}
                    >
                        {saving ? coreT({key: "ui.common.adding"}) : coreT({key: "ui.common.add"})}
                    </button>
                </div>
            </div>
        </div>
    );
}
