/**
 * Desktop 动态区宏 chip 行：点击在关联 textarea 当前选区插入白名单宏 token。
 * 把 customAttach / dynamic 两处重复的 chip + insertTextAtSelection + rAF 选区回写收敛到这里。
 */
import { type RefObject } from "react";
import {
  PROMPT_INSERTABLE_MACROS,
  insertTextAtSelection,
} from "./prompt-macro-input";

export type PromptMacroChipsProps = {
  /** 当前文本（chip 在其选区位置插入 token）。 */
  value: string;
  /** 插入后的新文本回写。 */
  onChange: (next: string) => void;
  /** 关联 textarea 的 ref；为 null 时退化为追加到末尾。 */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  /** 点击 chip 后、读取选区前触发（dynamic 区用于先把目标块标为活跃）。 */
  onBeforeInsert?: () => void;
};

export function PromptMacroChips({
  value,
  onChange,
  textareaRef,
  disabled,
  onBeforeInsert,
}: PromptMacroChipsProps) {
  return (
    <div className="config-dep-chips">
      <span className="config-block-card__hint">宏：</span>
      {PROMPT_INSERTABLE_MACROS.map((macro) => (
        <button
          key={macro.token}
          type="button"
          className="config-dep-chip"
          disabled={disabled}
          onClick={() => {
            onBeforeInsert?.();
            const ta = textareaRef.current;
            const selection =
              ta != null
                ? { start: ta.selectionStart, end: ta.selectionEnd }
                : { start: value.length, end: value.length };
            const { next, selection: nextSel } = insertTextAtSelection(
              value,
              selection,
              macro.token
            );
            onChange(next);
            requestAnimationFrame(() => {
              const el = textareaRef.current;
              if (el != null) {
                el.focus();
                el.setSelectionRange(nextSel.start, nextSel.end);
              }
            });
          }}
        >
          {macro.label}
        </button>
      ))}
    </div>
  );
}
