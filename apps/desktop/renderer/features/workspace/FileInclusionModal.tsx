import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/ui/show-toast";
import {
  entryLabelForTarget,
  saveFileInclusion,
} from "./workspace-actions";
import type { WorkspaceContextTarget } from "./workspace-context";

type InclusionMode = "auto" | "show" | "hide";

const INCLUSION_OPTIONS: Array<{
  value: InclusionMode;
  label: string;
  hint: string;
}> = [
  {
    value: "show",
    label: "展示",
    hint: "强制纳入 Agent 上下文，显示全内容",
  },
  {
    value: "hide",
    label: "隐藏",
    hint: "强制不纳入 Agent 上下文",
  },
  {
    value: "auto",
    label: "跟随",
    hint: "由父目录纳入规则决定（默认）",
  },
];

type FileInclusionModalProps = {
  open: boolean;
  target: WorkspaceContextTarget | null;
  projectId: string | undefined;
  sessionId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
};

export function FileInclusionModal({
  open,
  target,
  projectId,
  sessionId,
  onClose,
  onSaved,
}: FileInclusionModalProps) {
  const [saving, setSaving] = useState(false);
  const [inclusionMode, setInclusionMode] = useState<InclusionMode>("auto");

  const logicalPath =
    target?.kind === "row" && target.row.kind === "file"
      ? target.row.path
      : null;

  useEffect(() => {
    if (!open || !target || target.kind !== "row" || target.row.kind !== "file") {
      return;
    }
    setInclusionMode(target.row.inclusionMode);
  }, [open, target]);

  if (!open || !target || !logicalPath) {
    return null;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveFileInclusion(
        target,
        inclusionMode,
        projectId,
        sessionId,
      );
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
        className="text-prompt-modal text-prompt-modal--wide file-inclusion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-inclusion-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="file-inclusion-modal__header">
          <h3 id="file-inclusion-modal-title" className="file-inclusion-modal__title">
            文件纳入状态
          </h3>
          <p className="file-inclusion-modal__path">{entryLabelForTarget(target)}</p>
        </header>

        <fieldset className="file-inclusion-modal__options" aria-label="纳入方式">
          {INCLUSION_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`file-inclusion-modal__option${inclusionMode === opt.value ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name="inclusion-mode"
                value={opt.value}
                checked={inclusionMode === opt.value}
                onChange={() => setInclusionMode(opt.value)}
              />
              <span className="file-inclusion-modal__option-body">
                <span className="file-inclusion-modal__option-label">{opt.label}</span>
                <span className="file-inclusion-modal__option-hint">{opt.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="text-prompt-modal__actions">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
