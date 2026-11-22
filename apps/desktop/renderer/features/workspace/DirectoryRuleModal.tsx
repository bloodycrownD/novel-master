import { DEFAULT_WORKPLACE_DIR_RULE } from "@shared/logic/workplace";
import { useEffect, useState } from "react";
import { coreT } from "@shared/logic/core-i18n";
import type { WorkplaceSetDirRuleRequest } from "@shared/ipc-types";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/show-toast";
import {
    entryLabelForTarget,
    loadDirRuleForm,
    saveDirRule,
    scopeRequestFromTarget,
} from "./workspace-actions";
import type { WorkspaceContextTarget } from "./workspace-context";

type SortField = NonNullable<WorkplaceSetDirRuleRequest["sortField"]>;
type SortOrder = NonNullable<WorkplaceSetDirRuleRequest["sortOrder"]>;
type FillPolicy = NonNullable<WorkplaceSetDirRuleRequest["fillPolicy"]>;
type UiFillPolicy = Exclude<FillPolicy, "full">;

const SORT_FIELDS: Array<{ value: SortField; label: string }> = [
    { value: "name", label: coreT({key: "ui.vfs.sort_by_name"}) },
    { value: "created", label: coreT({key: "ui.vfs.sort_by_created"}) },
    { value: "updated", label: coreT({key: "ui.vfs.sort_by_updated"}) },
    // 同文借用 ui.nav.settings_smart_sort（域标签语义偏差，对号表外借待 3c 裁决）。
    { value: "smart", label: coreT({key: "ui.nav.settings_smart_sort"}) },
];

const SORT_ORDERS: Array<{ value: SortOrder; label: string }> = [
    { value: "asc", label: coreT({key: "ui.vfs.sort_asc"}) },
    { value: "desc", label: coreT({key: "ui.vfs.sort_desc"}) },
];

const FILL_POLICIES: Array<{ value: UiFillPolicy; label: string }> = [
    { value: "filename", label: coreT({key: "label.workplace.display.filename"}) },
    { value: "header", label: coreT({key: "ui.vfs.header_field_header"}) },
    { value: "hidden", label: coreT({key: "ui.vfs.header_field_hidden"}) },
];

function normalizeFillPolicy(fillPolicy: FillPolicy | undefined): UiFillPolicy {
    if (
        fillPolicy === "filename" ||
        fillPolicy === "header" ||
        fillPolicy === "hidden"
    ) {
        return fillPolicy;
    }
    return DEFAULT_WORKPLACE_DIR_RULE.fillPolicy;
}

function clampCount(raw: string): number {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) {
        return 0;
    }
    return Math.min(1000, Math.max(0, n));
}

type DirectoryRuleModalProps = {
    open: boolean;
    target: WorkspaceContextTarget | null;
    projectId: string | undefined;
    sessionId: string | undefined;
    onClose: () => void;
    onSaved: () => void;
};

export function DirectoryRuleModal({
    open,
    target,
    projectId,
    sessionId,
    onClose,
    onSaved,
}: DirectoryRuleModalProps) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [ruleEnabled, setRuleEnabled] = useState(false);
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
    const [headCount, setHeadCount] = useState("0");
    const [tailCount, setTailCount] = useState("1000");
    const [fillPolicy, setFillPolicy] = useState<UiFillPolicy>(
        DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    );

    const logicalPath = target?.kind === "row" && target.row.kind === "dir" ? target.row.path : null;
    const rootRuleLocked = logicalPath === "/";

    useEffect(() => {
        if (!open || !target || !logicalPath) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        void loadDirRuleForm(target, projectId, sessionId)
            .then((form) => {
                if (cancelled || !form) {
                    return;
                }
                setRuleEnabled(rootRuleLocked ? true : form.ruleEnabled);
                setSortField(form.sortField ?? "name");
                setSortOrder(form.sortOrder ?? "asc");
                setHeadCount(String(form.headCount ?? 0));
                setTailCount(String(form.tailCount ?? 1000));
                setFillPolicy(normalizeFillPolicy(form.fillPolicy));
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, target, logicalPath, projectId, sessionId, rootRuleLocked]);

    if (!open || !target || !logicalPath) {
        return null;
    }

    const handleSave = async () => {
        setSaving(true);
        try {
            const result = await saveDirRule({
                ...scopeRequestFromTarget(target, projectId, sessionId),
                logicalPath,
                ruleEnabled: rootRuleLocked ? true : ruleEnabled,
                sortField,
                sortOrder,
                headCount: clampCount(headCount),
                tailCount: clampCount(tailCount),
                fillPolicy,
            });
            if (result.ok) {
                onSaved();
                onClose();
            } else {
                showToast(result.message);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="text-prompt-overlay" onClick={onClose}>
            <div
                className="text-prompt-modal text-prompt-modal--wide dir-rule-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="dir-rule-modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="dir-rule-modal__header">
                    <h3 id="dir-rule-modal-title" className="dir-rule-modal__title">
                        {coreT({key: "ui.vfs.menu_directory_rule"})}
                    </h3>
                    <p className="dir-rule-modal__path">{entryLabelForTarget(target)}</p>
                </header>

                {loading ? (
                    <p className="dir-rule-modal__loading">{coreT({key: "ui.common.loading"})}</p>
                ) : (
                    <div className="dir-rule-modal__form">
                        {/* 规则启用/关闭由工作区右键菜单的快捷开关负责，表单内不再提供开关，
                仅编辑规则内容；ruleEnabled 沿用加载到的既有状态原样保存。 */}
                        <FieldLabel text={coreT({key: "ui.vfs.sort_mode_label"})} />
                        <OptionChips
                            options={SORT_FIELDS}
                            value={sortField}
                            onChange={setSortField}
                        />

                        <FieldLabel text={coreT({key: "ui.vfs.sort_dir_label"})} />
                        <OptionChips
                            options={SORT_ORDERS}
                            value={sortOrder}
                            onChange={setSortOrder}
                        />

                        <FieldLabel text={coreT({key: "ui.vfs.header_count_label"})} />
                        <input
                            className="text-prompt-modal__input"
                            type="number"
                            min={0}
                            max={1000}
                            value={headCount}
                            onChange={(e) => setHeadCount(e.target.value)}
                        />

                        <FieldLabel text={coreT({key: "ui.vfs.tail_count_label"})} />
                        <input
                            className="text-prompt-modal__input"
                            type="number"
                            min={0}
                            max={1000}
                            value={tailCount}
                            onChange={(e) => setTailCount(e.target.value)}
                        />

                        <FieldLabel text={coreT({key: "ui.vfs.rest_fill_label"})} />
                        <OptionChips
                            options={FILL_POLICIES}
                            value={fillPolicy}
                            onChange={setFillPolicy}
                        />
                    </div>
                )}

                <div className="text-prompt-modal__actions">
                    <Button variant="secondary" disabled={saving} onClick={onClose}>
                        {coreT({key: "ui.common.cancel"})}
                    </Button>
                    <Button
                        variant="primary"
                        disabled={loading || saving}
                        onClick={() => void handleSave()}
                    >
                        {saving ? coreT({key: "ui.common.saving"}) : coreT({key: "ui.common.save"})}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function FieldLabel({ text }: { text: string }) {
    return <p className="dir-rule-modal__label">{text}</p>;
}

function OptionChips<T extends string>({
    options,
    value,
    onChange,
}: {
    options: Array<{ value: T; label: string }>;
    value: T;
    onChange: (next: T) => void;
}) {
    return (
        <div className="config-dep-chips dir-rule-modal__chips">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    className={`config-dep-chip${opt.value === value ? " is-active" : ""}`}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
