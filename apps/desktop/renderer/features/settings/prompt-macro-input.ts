/**
 * Desktop 动态区宏：白名单分段 / 高亮 HTML / 原子删（与 Mobile prompt-macro-input 对齐）。
 */
import { ALLOWED_DYNAMIC_ROOT_MACROS } from "@shared/logic/prompt";

export type PromptInsertableMacro = {
  readonly label: string;
  readonly token: string;
};

export const PROMPT_INSERTABLE_MACROS: readonly PromptInsertableMacro[] =
  ALLOWED_DYNAMIC_ROOT_MACROS.map((key) => ({
    label: `$${key}`,
    token: `{{$${key}}}`,
  }));

const ALLOWED_ROOT_MACRO_KEYS = new Set<string>(ALLOWED_DYNAMIC_ROOT_MACROS);

export type WhitelistMacroRange = {
  readonly start: number;
  readonly end: number;
  readonly value: string;
};

function isWhitelistRootMacroInner(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed.startsWith("$")) {
    return false;
  }
  const rest = trimmed.slice(1).trim();
  if (rest.length === 0 || rest.startsWith(".") || rest.includes(".")) {
    return false;
  }
  return ALLOWED_ROOT_MACRO_KEYS.has(rest);
}

export function findWhitelistMacroRanges(
  text: string
): readonly WhitelistMacroRange[] {
  const ranges: WhitelistMacroRange[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{{", index);
    if (open < 0) {
      break;
    }
    const close = text.indexOf("}}", open + 2);
    if (close < 0) {
      break;
    }
    const value = text.slice(open, close + 2);
    const inner = text.slice(open + 2, close);
    if (isWhitelistRootMacroInner(inner)) {
      ranges.push({ start: open, end: close + 2, value });
    }
    index = close + 2;
  }
  return ranges;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 白名单宏着色 HTML；value 仍为纯文本（无 span）。 */
export function renderPromptMacroHighlightHtml(text: string): string {
  if (text === "") {
    return "";
  }
  const ranges = findWhitelistMacroRanges(text);
  let html = "";
  let cursor = 0;
  for (const range of ranges) {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<span class="prompt-macro__token">${escapeHtml(range.value)}</span>`;
    cursor = range.end;
  }
  html += escapeHtml(text.slice(cursor));
  if (text.endsWith("\n")) {
    html += "<br/>";
  }
  return html;
}

/**
 * 单次连续删除若碰到白名单宏区间，整段删掉。
 * @returns 新的纯文本；无需原子删时返回 null
 */
export function tryAtomicMacroDelete(
  prevValue: string,
  changedValue: string
): string | null {
  if (changedValue.length >= prevValue.length) {
    return null;
  }
  let prefix = 0;
  const minLen = Math.min(changedValue.length, prevValue.length);
  while (prefix < minLen && changedValue[prefix] === prevValue[prefix]) {
    prefix++;
  }
  const deletedCount = prevValue.length - changedValue.length;
  const deleteStart = prefix;
  const deleteEnd = deleteStart + deletedCount;
  const afterOld = prevValue.slice(deleteEnd);
  const afterNew = changedValue.slice(deleteStart);
  if (afterOld !== afterNew) {
    return null;
  }
  const hitRange = findWhitelistMacroRanges(prevValue).find(
    (range) => deleteStart < range.end && deleteEnd > range.start
  );
  if (hitRange == null) {
    return null;
  }
  if (deleteStart <= hitRange.start && deleteEnd >= hitRange.end) {
    return null;
  }
  return prevValue.slice(0, hitRange.start) + prevValue.slice(hitRange.end);
}

export function insertTextAtSelection(
  value: string,
  selection: { readonly start: number; readonly end: number },
  insert: string
): {
  readonly next: string;
  readonly selection: { readonly start: number; readonly end: number };
} {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const next = value.slice(0, start) + insert + value.slice(end);
  const cursor = start + insert.length;
  return { next, selection: { start: cursor, end: cursor } };
}
