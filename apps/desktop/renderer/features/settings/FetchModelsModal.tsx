import { useCallback, useEffect, useMemo, useState } from "react";
import { BatchCheckbox } from "../../components/batch/BatchCheckbox";
import { Button } from "../../components/ui/Button";
import {
  ipcProviderModelsFetch,
  ipcProviderModelsSave,
  ipcProviderModelsSuggestList,
} from "../../ipc/client";
import { useBatchSelection } from "../../hooks/useBatchSelection";

type SuggestionRow = {
  vendorModelId: string;
  displayName: string;
};

type FetchModelsModalProps = {
  open: boolean;
  providerId: string;
  savedVendorIds: readonly string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError?: (message: string) => void;
};

export function FetchModelsModal({
  open,
  providerId,
  savedVendorIds,
  onClose,
  onSaved,
  onError,
}: FetchModelsModalProps) {
  const { exit, toggle, isSelected, selectedCount } = useBatchSelection();
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const savedSet = useMemo(() => new Set(savedVendorIds), [savedVendorIds]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const fetchRes = await ipcProviderModelsFetch({ providerId });
      if (!fetchRes.ok) {
        setRows([]);
        setError(fetchRes.error.message);
        return;
      }
      const sugRes = await ipcProviderModelsSuggestList({ providerId });
      if (!sugRes.ok) {
        setRows([]);
        setError(sugRes.error.message);
        return;
      }
      setRows(
        sugRes.data
          .filter((s) => !s.stale)
          .map((s) => ({
            vendorModelId: s.vendorModelId,
            displayName: s.displayName ?? s.vendorModelId,
          })),
      );
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    exit();
    setRows([]);
    setError(undefined);
    void load();
  }, [open, load, exit]);

  if (!open) {
    return null;
  }

  const selectableRows = rows.filter((r) => !savedSet.has(r.vendorModelId));
  const confirmLabel =
    selectedCount > 0 ? `添加 (${selectedCount})` : "添加";

  const handleConfirm = async () => {
    if (selectedCount === 0 || saving) {
      return;
    }
    setSaving(true);
    try {
      const selected = rows.filter(
        (r) => isSelected(r.vendorModelId) && !savedSet.has(r.vendorModelId),
      );
      for (const row of selected) {
        const res = await ipcProviderModelsSave({
          providerId,
          vendorModelId: row.vendorModelId,
          displayName: row.displayName !== row.vendorModelId ? row.displayName : undefined,
        });
        if (!res.ok) {
          onError?.(res.error.message);
          return;
        }
      }
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="fetch-models-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fetch-models-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="fetch-models-title" className="fetch-models-modal__title">
          拉取模型
        </h3>
        <p className="fetch-models-modal__hint">
          从服务商获取可用模型，勾选后批量添加
        </p>

        {loading ? (
          <p className="fetch-models-modal__status">拉取中…</p>
        ) : error ? (
          <div className="fetch-models-modal__status fetch-models-modal__status--error">
            <p>{error}</p>
            <button
              type="button"
              className="fetch-models-modal__retry"
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="fetch-models-modal__status">
            未拉取到可用模型，请检查 API Key 与 Base URL。
          </p>
        ) : (
          <ul className="fetch-models-modal__list">
            {rows.map((row) => {
              const saved = savedSet.has(row.vendorModelId);
              const selected = isSelected(row.vendorModelId);
              const title = row.displayName.trim() || row.vendorModelId;
              const showMeta =
                row.displayName.trim() && row.displayName.trim() !== row.vendorModelId;
              return (
                <li key={row.vendorModelId}>
                  <button
                    type="button"
                    className={`fetch-models-modal__row${selected ? " is-selected" : ""}${saved ? " is-saved" : ""}`}
                    disabled={saved || saving}
                    onClick={() => {
                      if (!saved) {
                        toggle(row.vendorModelId);
                      }
                    }}
                  >
                    {saved ? (
                      <span className="fetch-models-modal__row-spacer" aria-hidden="true" />
                    ) : (
                      <BatchCheckbox
                        checked={selected}
                        onToggle={() => toggle(row.vendorModelId)}
                      />
                    )}
                    <span className="fetch-models-modal__row-text">
                      <span className="fetch-models-modal__row-title">{title}</span>
                      {showMeta ? (
                        <span className="fetch-models-modal__row-meta">{row.vendorModelId}</span>
                      ) : null}
                    </span>
                    {saved ? (
                      <span className="fetch-models-modal__row-badge">已添加</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && selectableRows.length > 0 ? (
          <p className="fetch-models-modal__count">已选 {selectedCount} 项</p>
        ) : null}

        <div className="confirm-modal__actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={selectedCount === 0 || saving || loading}
            onClick={() => void handleConfirm()}
          >
            {saving ? "添加中…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
