/**
 * 提示词超长折叠 + 全屏编辑字段（desktop）。
 *
 * 自包含包装组件：children 承载原内联编辑器（textarea / PromptMacroTextarea），
 * 保留 Enter 快捷键与宏 chips 等全部内联能力；短文本（或聚焦保持）时原样渲染
 * children，内容溢出可视高度（语义上超过约 5 行，见 prompt-collapse.ts）且
 * 失焦后折叠为 3 行省略只读预览，点击预览进入全屏 Modal 编辑草稿副本，
 * 保存（按钮或 Mod-s）才回填 onChange，取消不动。
 *
 * 超长判据是 DOM 实测而非字符数：textarea 的 rows/min-height 决定可视行数，
 * scrollHeight 超过 clientHeight 即可见高度装不下内容，据此与
 * 「超过 5 行折叠」的语义对齐（不精确数行）。
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";

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

/**
 * 在包装层内找 textarea，实测内容是否溢出可视高度（超长判据）。
 * 找不到 textarea 时（当前六处输入点都是 textarea / PromptMacroTextarea，
 * 该场景实际不存在）保守视为不超长，不折叠。
 */
function measureOverflow(wrapper: HTMLDivElement | null): boolean {
  const ta = wrapper?.querySelector("textarea");
  if (!ta) {
    return false;
  }
  return ta.scrollHeight > ta.clientHeight + 1;
}

export function PromptCollapsibleField({
  value,
  onChange,
  children,
  ariaLabel,
}: PromptCollapsibleFieldProps) {
  // 包装层 ref：内联 textarea 挂在下面，供 DOM 实测用。
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 聚焦保持：children 内任一元素聚焦时不折叠（React 合成 focus/blur 会冒泡到本层）。
  const [focusHold, setFocusHold] = useState(false);
  // DOM 实测的超长标记（内容溢出可视高度）。
  const [overlong, setOverlong] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // Modal 内草稿副本，保存才回填。
  const [draft, setDraft] = useState(value);
  // 展开入口已接管的标记：抑制随后那次 blur 折叠，防止预览被点卸载导致 click 丢失。
  const pendingOpenRef = useRef(false);
  // 折叠态下 children 已卸载、无从实测；内容变化时先回 inline 重挂，
  // 再用这个扳机触发一轮补测（仍超长则重新折叠，全程绘制前完成、不闪帧）。
  const [probe, setProbe] = useState(0);
  // 上一轮处理时的 value，用于区分「内容变了要重测」和「折叠中本来就测不到」。
  const prevValueRef = useRef(value);

  const collapsed = overlong && !focusHold;

  // 挂载后与每次 value 变化后实测超长。用 layout effect 在绘制前完成：
  // 初始长文直接折叠、首帧不撑表单；全屏保存回填后内容变矮则当帧回到 inline。
  useLayoutEffect(() => {
    const valueChanged = prevValueRef.current !== value;
    prevValueRef.current = value;
    if (wrapperRef.current?.querySelector("textarea")) {
      setOverlong(measureOverflow(wrapperRef.current));
      return;
    }
    // 此处无 textarea：要么处于折叠态（children 卸载），要么 children 不是
    // textarea。折叠中且内容已变（如全屏保存回填）→ 先回 inline 重挂，等 probe
    // 那一轮补测；非 textarea 场景则保持 inline（保守不折叠）。
    if (valueChanged) {
      setOverlong(false);
      setProbe((p) => p + 1);
    }
  }, [value, probe]);

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
    // 失焦折叠前重测一次，吸收窗口宽度变化等造成的行数漂移。
    setOverlong(measureOverflow(wrapperRef.current));
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
    <div ref={wrapperRef} onFocus={handleFocus} onBlur={handleBlur}>
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
