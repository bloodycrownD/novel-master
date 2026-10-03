import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  zipDirectoryPathForTarget,
  type WorkspaceContextTarget,
} from "./workspace-context";

/**
 * 导入形式（菜单「导入」弹窗的三个选项）。
 *
 * 取值与 E2E 锚 `data-import-form="zip|card|file"` 一一对应，E2E 靠它点选，
 * 改这里必须同步改 E2E 选择器。E2E 流程是两步：点选项选中 → 点
 * `data-import-form-submit` 提交，选项本身不生效。
 */
export type ImportForm = "zip" | "card" | "file";

/**
 * 三个选项的 label + hint。
 *
 * hint 各自承载该形式的覆盖语义（D9：覆盖确认文案拆三份，选择环节先让用户看见差异）——
 * ZIP 覆盖目标目录全部内容、角色卡覆盖目标目录、单文件只可能撞同名文件。
 */
const IMPORT_FORM_OPTIONS: Array<{
  value: ImportForm;
  label: string;
  hint: string;
}> = [
  {
    value: "zip",
    label: "ZIP 包",
    hint: "解压到目标目录，将覆盖目标目录下全部内容",
  },
  {
    value: "card",
    label: "角色卡",
    hint: "解析角色卡并写入目标目录，将覆盖目标目录内的同名文件",
  },
  {
    value: "file",
    label: "单文件",
    hint: "写入单个文件，同名文件存在时需确认后才会覆盖",
  },
];

type ImportFormModalProps = {
  open: boolean;
  target: WorkspaceContextTarget | null;
  /** 与 DirectoryRuleModal/FileInclusionModal 同形；编排由 App 侧持有，这里只展示。 */
  projectId: string | undefined;
  sessionId: string | undefined;
  onClose: () => void;
  /**
   * 点底部「导入」主按钮才触发：App 按形式分流（zip/card 进既有确认弹窗，
   * file 走选择+ingest 链）。**唯一触发源就是这枚按钮**——选项 label 只改选中态。
   */
  onSelect: (form: ImportForm) => void;
};

export function ImportFormModal({
  open,
  target,
  onClose,
  onSelect,
}: ImportFormModalProps) {
  const [selected, setSelected] = useState<ImportForm>("zip");

  // 每次打开重置为默认形式（照 FileInclusionModal 的 [open, target] effect）：
  // 防二次打开时带着上一次的选中项，用户以为已经选好了就直接点确认。
  useEffect(() => {
    if (!open || !target) {
      return;
    }
    setSelected("zip");
  }, [open, target]);

  if (!open || !target) {
    return null;
  }

  const directoryPath = zipDirectoryPathForTarget(target);

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="text-prompt-modal text-prompt-modal--wide file-inclusion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-form-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="file-inclusion-modal__header">
          <h3
            id="import-form-modal-title"
            className="file-inclusion-modal__title"
          >
            导入
          </h3>
          <p className="file-inclusion-modal__path">
            {directoryPath == null || directoryPath === "/"
              ? "当前目录（工作区根）"
              : directoryPath}
          </p>
        </header>

        <fieldset
          className="file-inclusion-modal__options"
          aria-label="导入形式"
        >
          {IMPORT_FORM_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              data-import-form={opt.value}
              className={`file-inclusion-modal__option${selected === opt.value ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name="import-form"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
              />
              <span className="file-inclusion-modal__option-body">
                <span className="file-inclusion-modal__option-label">
                  {opt.label}
                </span>
                <span className="file-inclusion-modal__option-hint">
                  {opt.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="text-prompt-modal__actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          {/* 确认入口：onSelect 的唯一触发源。data-import-form-submit 是 E2E 选择器锚。 */}
          <Button
            variant="primary"
            data-import-form-submit
            onClick={() => {
              onSelect(selected);
              onClose();
            }}
          >
            导入
          </Button>
        </div>
      </div>
    </div>
  );
}
