/**
 * 提示词超长折叠 + 全屏编辑字段（desktop）。
 *
 * 自包含包装组件：children 承载原内联编辑器（textarea / PromptMacroTextarea），
 * 保留 Enter 快捷键与宏 chips 等全部内联能力；短文本（或聚焦保持）时原样渲染
 * children，value 超过阈值且失焦后折叠为 3 行省略只读预览，点击预览进入
 * 全屏 Modal 编辑草稿副本，保存（按钮或 Mod-s）才回填 onChange，取消不动。
 */
import { useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { isPromptCollapsed } from "./prompt-collapse";

type PromptCollapsibleFieldProps = {
  /** 当前值（受控）。 */
  value: string;
  /** 全屏编辑保存时回填（内联编辑由 children 自行接 state，不走这里）。 */
  onChange: (next: string) => void;
  /** 内联编辑器 JSX（原样渲染，能力不变）。 */
  children: ReactNode;
  /** 透传给全屏编辑器的无障碍标签。 */
  ariaLabel?: string;
};

export function PromptCollapsibleField({
  value,
  onChange,
  children,
  ariaLabel,
}: PromptCollapsibleFieldProps) {
  // 聚焦保持：children 内任一元素聚焦时不折叠（React 合成 focus/blur 会冒泡到本层）。
  const [focusHold, setFocusHold] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // Modal 内草稿副本，保存才回填。
  const [draft, setDraft] = useState(value);
  // 展开入口已接管的标记：抑制随后那次 blur 折叠，防止预览被点卸载导致 click 丢失。
  const pendingOpenRef = useRef(false);

  const collapsed = isPromptCollapsed(value) && !focusHold;

  const handleFocus = () => {
    // 点击折叠预览引发的焦点移动不解除折叠（此时正要打开 Modal）。
    if (pendingOpenRef.current) {
      return;
    }
    setFocusHold(true);
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (pendingOpenRef.current) {
      // 展开操作接管中，交给 openEditor 流程收尾。
      return;
    }
    // 焦点仍在包装层内（如从 textarea 移到宏 chip）不算失焦，保持内联编辑。
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
      return;
    }
    setFocusHold(false);
  };

  const openEditor = () => {
    setDraft(value);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    // Modal 内焦点移出会触发一次 blur，这里延后清除标记让该次 blur 被吞掉不折叠。
    requestAnimationFrame(() => {
      pendingOpenRef.current = false;
    });
  };

  const saveEditor = () => {
    onChange(draft);
    closeEditor();
  };

  return (
    <div onFocus={handleFocus} onBlur={handleBlur}>
      {collapsed ? (
        <div
          className="prompt-field-clamp"
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          title="点击全屏编辑"
          onPointerDown={(e) => {
            // 先置标记再（可能）发生焦点移动，防 blur 折叠竞态；
            // preventDefault 阻止预览自身抢焦点，保证 click 稳定派发。
            pendingOpenRef.current = true;
            e.preventDefault();
          }}
          onClick={openEditor}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pendingOpenRef.current = true;
              openEditor();
            }
          }}
        >
          {value}
        </div>
      ) : (
        children
      )}
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
