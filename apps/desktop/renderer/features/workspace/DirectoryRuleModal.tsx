import { DEFAULT_WORKPLACE_DIR_RULE } from "@novel-master/core/workplace";
import { useEffect, useState } from "react";
import type { WorkplaceSetDirRuleRequest } from "@shared/ipc-types";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
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
  { value: "name", label: "文件名称" },
  { value: "created", label: "创建时间" },
  { value: "updated", label: "更新时间" },
];

const SORT_ORDERS: Array<{ value: SortOrder; label: string }> = [
  { value: "asc", label: "升序" },
  { value: "desc", label: "降序" },
];

const FILL_POLICIES: Array<{ value: UiFillPolicy; label: string }> = [
  { value: "filename", label: "文件名" },
  { value: "header", label: "头信息" },
  { value: "hidden", label: "不展示" },
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

  const logicalPath =
    target?.kind === "row" && target.row.kind === "dir"
      ? target.row.path
      : null;
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
            目录规则
          </h3>
          <p className="dir-rule-modal__path">{entryLabelForTarget(target)}</p>
        </header>

        {loading ? (
          <p className="dir-rule-modal__loading">加载中…</p>
        ) : (
          <div className="dir-rule-modal__form">
            <div className="dir-rule-modal__switch-field">
              <div className="dir-rule-modal__switch-head">
                <FieldLabel text="规则启用" />
                <Switch
                  checked={ruleEnabled}
                  disabled={rootRuleLocked}
                  onChange={setRuleEnabled}
                  aria-label="规则启用"
                />
              </div>
              {rootRuleLocked ? (
                <p className="dir-rule-modal__hint">根目录规则不可关闭</p>
              ) : null}
            </div>

            <FieldLabel text="排序字段" />
            <OptionChips
              options={SORT_FIELDS}
              value={sortField}
              onChange={setSortField}
            />

            <FieldLabel text="排序方向" />
            <OptionChips
              options={SORT_ORDERS}
              value={sortOrder}
              onChange={setSortOrder}
            />

            <FieldLabel text="头部数量 (0–1000)" />
            <input
              className="text-prompt-modal__input"
              type="number"
              min={0}
              max={1000}
              value={headCount}
              onChange={(e) => setHeadCount(e.target.value)}
            />

            <FieldLabel text="尾部数量 (0–1000)" />
            <input
              className="text-prompt-modal__input"
              type="number"
              min={0}
              max={1000}
              value={tailCount}
              onChange={(e) => setTailCount(e.target.value)}
            />

            <FieldLabel text="其余文件填充" />
            <OptionChips
              options={FILL_POLICIES}
              value={fillPolicy}
              onChange={setFillPolicy}
            />
          </div>
        )}

        <div className="text-prompt-modal__actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={loading || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存"}
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
