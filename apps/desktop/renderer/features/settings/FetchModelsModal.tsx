import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { coreT } from "@shared/logic/core-i18n";
import { BatchCheckbox } from "@/components/batch/BatchCheckbox";
import { Button } from "@/components/ui/Button";
import {
    ipcProviderModelsFetch,
    ipcProviderModelsSave,
    ipcProviderModelsSuggestList,
    ipcRunAbort,
} from "@/ipc/client";
import { settingsTranslator } from "@/i18n/settings";
import { useBatchSelection } from "@/hooks/useBatchSelection";

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
    const { exit, toggle, isSelected, selectedCount, selectRange } = useBatchSelection();
    const [rows, setRows] = useState<SuggestionRow[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [cancelled, setCancelled] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | undefined>();
    // 已保存成功的行（与 mobile FetchModelsSheet 的 addedIds 同语义）：
    // 部分失败重试时跳过已保存行，避免重复 save。
    const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

    const savedSet = useMemo(
        () => new Set([...savedVendorIds, ...addedIds]),
        [savedVendorIds, addedIds],
    );

    // 过滤只作用展示层：displayName 为空（含纯空白）时只按 vendorModelId 匹配。
    const filteredRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return rows;
        }
        return rows.filter((row) => {
            const name = row.displayName.trim();
            return (
                (name !== "" && name.toLowerCase().includes(q)) ||
                row.vendorModelId.toLowerCase().includes(q)
            );
        });
    }, [rows, query]);

    const load = useCallback(async () => {
        setLoading(true);
        setCancelled(false);
        setCancelling(false);
        setError(undefined);
        try {
            const fetchRes = await ipcProviderModelsFetch({ providerId });
            if (!fetchRes.ok) {
                setRows([]);
                // 取消是控制流终态（IPC_ABORTED），不渲染成错误；落到「已取消 + 重试」态。
                if (fetchRes.error.code === "IPC_ABORTED") {
                    setCancelled(true);
                    return;
                }
                setError(fetchRes.error.message);
                return;
            }
            const sugRes = await ipcProviderModelsSuggestList({ providerId });
            if (!sugRes.ok) {
                setRows([]);
                if (sugRes.error.code === "IPC_ABORTED") {
                    setCancelled(true);
                    return;
                }
                setError(sugRes.error.message);
                return;
            }
            setRows( sugRes.data .filter((s) => !s.stale) .map((s) => ({ vendorModelId: s.vendorModelId, displayName: s.displayName ?? s.vendorModelId })) );
        } finally {
            setLoading(false);
        }
    }, [providerId]);

    useEffect(() => {
        if (!open) {
            return;
        }
        exit();
        setAddedIds(new Set());
        setRows([]);
        setQuery("");
        setError(undefined);
        setCancelled(false);
        setCancelling(false);
        void load();
    }, [open, load, exit]);

    if (!open) {
        return null;
    }

    const selectableRows = rows.filter((r) => !savedSet.has(r.vendorModelId));
    // 过滤后可选（未保存）行：全选只作用于这部分，避免混入被过滤掉的旧勾选。
    const selectableFilteredRows = filteredRows.filter(
        (r) => !savedSet.has(r.vendorModelId),
    );
    const allFilteredSelected = selectableFilteredRows.length > 0 && selectableFilteredRows.every((r) => isSelected(r.vendorModelId));
    const handleSelectAll = () => {
        // 全选重置为「过滤后可选行全选」；全不选清空全部勾选。
        selectRange( allFilteredSelected ? [] : selectableFilteredRows.map((r) => r.vendorModelId) );
    };
    const confirmLabel = selectedCount > 0 ? coreT({key: "ui.provider.add_count_confirm", params: {count: selectedCount}}) : coreT({key: "ui.common.add"});

    const handleConfirm = async () => {
        if (selectedCount === 0 || saving) {
            return;
        }
        setSaving(true);
        try {
            const selected = rows.filter(
                (r) =>
                    isSelected(r.vendorModelId) &&
                    !savedSet.has(r.vendorModelId) &&
                    // 跳过本弹窗内已保存成功的行（部分失败重试不重复 save）
                    !addedIds.has(r.vendorModelId),
            );
            for (const row of selected) {
                const res = await ipcProviderModelsSave({
                    providerId,
                    vendorModelId: row.vendorModelId,
                    modelName: row.displayName !== row.vendorModelId ? row.displayName : undefined,
                });
                if (!res.ok) {
                    // 对齐 mobile：失败即停；已成功行标已添加，失败行保留勾选方便重试
                    onError?.(res.error.message);
                    setAddedIds((prev) => new Set(prev).add(row.vendorModelId));
                    return;
                }
                setAddedIds((prev) => new Set(prev).add(row.vendorModelId));
            }
            await onSaved();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    let statusNode: ReactNode;
    if (loading) {
        statusNode = (
            <div className="fetch-models-modal__status fetch-models-modal__status--loading">
                <p>{coreT({key: "ui.provider.fetching"})}</p>
                <button
                    type="button"
                    className="fetch-models-modal__cancel"
                    disabled={cancelling}
                    // providerModels 的取消键形态是 `models:<providerId>`（ABORT_KEY.providerModels），
                    // id 直接复用弹窗的 providerId；取消请求本身不弹 toast，终态由 load 的 IPC_ABORTED 分支收口。
                    onClick={() => {
                        if (cancelling) {
                            return;
                        }
                        setCancelling(true);
                        void (async () => {
                            try {
                                await ipcRunAbort({ kind: "models", id: providerId });
                            } catch {
                                // IPC bridge 不可用时保持 loading，用户可再次点击取消。
                            } finally {
                                setCancelling(false);
                            }
                        })();
                    }}
                >
                    {settingsTranslator({ key: "settings.long_task.cancel" })}
                </button>
            </div>
        );
    } else if (cancelled) {
        statusNode = (
            <div className="fetch-models-modal__status fetch-models-modal__status--cancelled">
                <p>{settingsTranslator({ key: "settings.long_task.cancelled" })}</p>
                <button
                    type="button"
                    className="fetch-models-modal__retry"
                    onClick={() => void load()}
                >
                    {coreT({key: "ui.common.retry"})}
                </button>
            </div>
        );
    } else if (error) {
        statusNode = (
            <div className="fetch-models-modal__status fetch-models-modal__status--error">
                <p>{error}</p>
                <button
                    type="button"
                    className="fetch-models-modal__retry"
                    onClick={() => void load()}
                >
                    {coreT({key: "ui.common.retry"})}
                </button>
            </div>
        );
    } else if (rows.length === 0) {
        statusNode = (
            <p className="fetch-models-modal__status">
                {coreT({key: "ui.provider.no_models_fetched"})}
            </p>
        );
    } else {
        statusNode = (
            <>
                <div className="fetch-models-modal__filter-bar">
                    <input
                        type="text"
                        className="fetch-models-modal__filter"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={coreT({key: "ui.provider.filter_models_placeholder"})}
                    />
                    <button
                        type="button"
                        className="fetch-models-modal__select-all"
                        disabled={saving || selectableFilteredRows.length === 0}
                        onClick={handleSelectAll}
                    >
                        {allFilteredSelected ? coreT({key: "ui.common.select_none"}) : coreT({key: "ui.common.select_all"})}
                    </button>
                </div>
                {filteredRows.length === 0 ? (
                    <p className="fetch-models-modal__status">{coreT({key: "ui.provider.no_matching_models"})}</p>
                ) : (
                    <ul className="fetch-models-modal__list">
                        {filteredRows.map((row) => {
                            const saved = savedSet.has(row.vendorModelId);
                            const selected = isSelected(row.vendorModelId);
                            const title = row.displayName.trim() || row.vendorModelId;
                            const showMeta = row.displayName.trim() && row.displayName.trim() !== row.vendorModelId;
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
                                            <span className="fetch-models-modal__row-badge">{coreT({key: "ui.common.added"})}</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </>
        );
    }

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
                    {coreT({key: "ui.provider.fetch_models_title"})}
                </h3>
                <p className="fetch-models-modal__hint">
                    {coreT({key: "ui.provider.fetch_models_hint"})}
                </p>

                {statusNode}

                {!loading && selectableRows.length > 0 ? (
                    <p className="fetch-models-modal__count">{coreT({key: "ui.common.selected_count", params: {count: selectedCount}})}</p>
                ) : null}

                <div className="confirm-modal__actions">
                    <Button variant="secondary" disabled={saving} onClick={onClose}>
                        {coreT({key: "ui.common.cancel"})}
                    </Button>
                    <Button
                        variant="primary"
                        disabled={selectedCount === 0 || saving || loading}
                        onClick={() => void handleConfirm()}
                    >
                        {saving ? coreT({key: "ui.common.adding"}) : confirmLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
}
