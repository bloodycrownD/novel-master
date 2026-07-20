/**
 * Desktop 动态区：透明 textarea + 高亮层；白名单宏 tag 观感与原子删；落库纯文本。
 */
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from "react";
import {
  renderPromptMacroHighlightHtml,
  tryAtomicMacroDelete,
} from "./prompt-macro-input";

export type PromptMacroTextareaProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  rows?: number;
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  "aria-label"?: string;
};

export function PromptMacroTextarea({
  textareaRef,
  value,
  onChange,
  disabled,
  rows = 4,
  onFocus,
  onKeyDown,
  "aria-label": ariaLabel,
}: PromptMacroTextareaProps) {
  const highlightRef = useRef<HTMLDivElement>(null);
  const prevValueRef = useRef(value);
  const highlightHtml = useMemo(
    () => renderPromptMacroHighlightHtml(value),
    [value]
  );

  useEffect(() => {
    prevValueRef.current = value;
  }, [value]);

  const syncHighlightScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const hl = highlightRef.current;
    if (hl == null) {
      return;
    }
    const ta = e.currentTarget;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  };

  return (
    <div className="prompt-macro__input-stack">
      <div
        ref={highlightRef}
        className="prompt-macro__highlight"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: highlightHtml || "&#8203;" }}
      />
      <textarea
        ref={textareaRef}
        className="prompt-macro__input prompt-macro__input--overlay"
        value={value}
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        aria-label={ariaLabel}
        onFocus={onFocus}
        onScroll={syncHighlightScroll}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const next = e.target.value;
          const atomic = tryAtomicMacroDelete(prevValueRef.current, next);
          const resolved = atomic ?? next;
          prevValueRef.current = resolved;
          onChange(resolved);
        }}
      />
    </div>
  );
}
