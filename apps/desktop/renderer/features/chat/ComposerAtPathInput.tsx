/**
 * Desktop：透明 textarea + 高亮层着色 `@路径`（落库仍为纯字符串）。
 */
import {
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from "react";

const AT_TOKEN_RE = /@([^\s@]+)/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 将正文中的 `@path` 标成高亮 span；其余转义。 */
export function renderComposerAtPathHighlightHtml(text: string): string {
  if (text === "") {
    return "";
  }
  let html = "";
  let last = 0;
  AT_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AT_TOKEN_RE.exec(text)) != null) {
    html += escapeHtml(text.slice(last, match.index));
    html += `<span class="chat-composer__at-token">${escapeHtml(match[0]!)}</span>`;
    last = match.index + match[0]!.length;
  }
  html += escapeHtml(text.slice(last));
  // 末尾换行在 pre-wrap 下需占位，否则与 textarea 高度错位
  if (text.endsWith("\n")) {
    html += "<br/>";
  }
  return html;
}

export type ComposerAtPathInputProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (text: string) => void;
  onSelectChange?: (cursor: number) => void;
  disabled?: boolean;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  "aria-label"?: string;
};

export function ComposerAtPathInput({
  textareaRef,
  value,
  onChange,
  onSelectChange,
  disabled,
  placeholder,
  onKeyDown,
  "aria-label": ariaLabel,
}: ComposerAtPathInputProps) {
  const highlightRef = useRef<HTMLDivElement>(null);
  const highlightHtml = useMemo(
    () => renderComposerAtPathHighlightHtml(value),
    [value],
  );

  const emitCursor = () => {
    const el = textareaRef.current;
    if (el != null) {
      onSelectChange?.(el.selectionStart);
    }
  };

  /** 高亮层与透明 textarea 滚动对齐，避免长文时 tag 错位。 */
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
    <div className="chat-composer__input-stack">
      <div
        ref={highlightRef}
        className="chat-composer__highlight"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: highlightHtml || "&#8203;" }}
      />
      <textarea
        ref={textareaRef}
        className="chat-composer__input chat-composer__input--overlay"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onSelectChange?.(e.target.selectionStart);
        }}
        onClick={emitCursor}
        onKeyUp={emitCursor}
        onSelect={emitCursor}
        onScroll={syncHighlightScroll}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
    </div>
  );
}
