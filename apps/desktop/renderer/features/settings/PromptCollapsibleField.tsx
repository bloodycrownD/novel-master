/**
 * 提示词内联限高 + 全屏编辑字段（desktop）。
 *
 * 包装组件：children 承载原内联编辑器（textarea / PromptMacroTextarea），
 * Enter 快捷键与宏 chips 等内联能力全部保留。包装层只做两件事：
 * 1. 给容器加 .prompt-field-inline，由 CSS 把内联 textarea 限高约 5 行，
 *    内容超出后内部滚动，输入不受限（实际限高在 shell.css）；
 * 2. 字段右上角全屏按钮：进入全屏 Modal 编辑草稿副本（CodeEditor），
 *    保存（按钮或 Mod-s）才回填 onChange，取消不动；Esc / 点击遮罩关闭。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";

type PromptCollapsibleFieldProps = {
  /** 当前值（受控）。 */
  value: string;
  /** 全屏编辑保存时回填（内联编辑由 children 自行接 state，不走这里）。 */
  onChange: (next: string) => void;
  /** 内联编辑器 JSX（原样渲染，能力不变）。 */
  children: ReactNode;
  /** 透传给全屏按钮与全屏编辑器的无障碍标签。 */
  ariaLabel?: string;
};

export function PromptCollapsibleField({
  value,
  onChange,
  children,
  ariaLabel,
}: PromptCollapsibleFieldProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  // Modal 内草稿副本，保存才回填。
  const [draft, setDraft] = useState(value);

  const closeEditor = () => setEditorOpen(false);

  const saveEditor = () => {
    onChange(draft);
    closeEditor();
  };

  // Esc 关闭 Modal。编辑器内部扩展（如自动补全）已消费的 Esc 不拦截。
  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setEditorOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editorOpen]);

  return (
    <div className="prompt-field-inline">
      {children}
      <button
        type="button"
        className="icon-btn prompt-field-inline__expand"
        aria-label={ariaLabel ? `全屏编辑：${ariaLabel}` : "全屏编辑"}
        title="全屏编辑"
        onClick={() => {
          setDraft(value);
          setEditorOpen(true);
        }}
      >
        ⛶
      </button>
      {editorOpen ? (
        <div className="text-prompt-overlay" onClick={closeEditor}>
          <div
            className="prompt-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            onClick={(e) => e.stopPropagation()}
          >
            <CodeEditor
              value={draft}
              languagePath="prompt.txt"
              onChange={setDraft}
              onSave={saveEditor}
              aria-label={ariaLabel}
            />
            <div className="prompt-editor-modal__footer">
              <Button variant="secondary" onClick={closeEditor}>
                取消
              </Button>
              <Button variant="primary" onClick={saveEditor}>
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
