import {ALLOWED_DYNAMIC_ROOT_MACROS} from '@novel-master/core/prompt';

export type PromptInsertableMacro = {
  readonly label: string;
  readonly token: string;
};

/** dynamic 区可插入的 Prompt 宏（白名单 $ 根键）。 */
export const PROMPT_INSERTABLE_MACROS: readonly PromptInsertableMacro[] =
  ALLOWED_DYNAMIC_ROOT_MACROS.map(key => ({
    label: `$${key}`,
    token: `{{$${key}}}`,
  }));

const ALLOWED_ROOT_MACRO_KEYS = new Set<string>(ALLOWED_DYNAMIC_ROOT_MACROS);

export type PromptMacroSegment =
  | {readonly kind: 'text'; readonly value: string}
  | {readonly kind: 'macro'; readonly value: string};

export type WhitelistMacroRange = {
  readonly start: number;
  readonly end: number;
  readonly value: string;
};

/** 判断 `{{ ... }}` 内文（trim 后）是否为白名单 `$` 根宏。 */
function isWhitelistRootMacroInner(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed.startsWith('$')) {
    return false;
  }
  const rest = trimmed.slice(1).trim();
  if (rest.length === 0 || rest.startsWith('.')) {
    return false;
  }
  if (rest.includes('.')) {
    return false;
  }
  return ALLOWED_ROOT_MACRO_KEYS.has(rest);
}

/**
 * 扫描全文，返回已闭合且内文为白名单根宏的 span（含手输与芯片插入形态）。
 * 未闭合 `{{`、非白名单、残缺 token 均不纳入。
 */
export function findWhitelistMacroRanges(
  text: string,
): readonly WhitelistMacroRange[] {
  const ranges: WhitelistMacroRange[] = [];
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('{{', index);
    if (open < 0) {
      break;
    }

    const close = text.indexOf('}}', open + 2);
    if (close < 0) {
      break;
    }

    const value = text.slice(open, close + 2);
    const inner = text.slice(open + 2, close);
    if (isWhitelistRootMacroInner(inner)) {
      ranges.push({start: open, end: close + 2, value});
    }

    index = close + 2;
  }

  return ranges;
}

/** 将纯文本拆分为字面量段与白名单完整宏 token。 */
export function splitPromptMacroSegments(text: string): readonly PromptMacroSegment[] {
  if (text === '') {
    return [];
  }

  const ranges = findWhitelistMacroRanges(text);
  if (ranges.length === 0) {
    return [{kind: 'text', value: text}];
  }

  const segments: PromptMacroSegment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (cursor < range.start) {
      segments.push({kind: 'text', value: text.slice(cursor, range.start)});
    }
    segments.push({kind: 'macro', value: range.value});
    cursor = range.end;
  }

  if (cursor < text.length) {
    segments.push({kind: 'text', value: text.slice(cursor)});
  }

  return segments;
}

/**
 * 单次连续删除若碰到白名单宏区间，整段删掉。
 * @returns 新的纯文本；无需原子删时返回 null
 */
export function tryAtomicMacroDelete(
  prevValue: string,
  changedValue: string,
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
    range => deleteStart < range.end && deleteEnd > range.start,
  );
  if (hitRange == null) {
    return null;
  }

  // 已覆盖整段宏：交给默认差分即可
  if (deleteStart <= hitRange.start && deleteEnd >= hitRange.end) {
    return null;
  }

  return prevValue.slice(0, hitRange.start) + prevValue.slice(hitRange.end);
}

export function insertTextAtSelection(
  value: string,
  selection: {readonly start: number; readonly end: number},
  insert: string,
): {readonly next: string; readonly selection: {readonly start: number; readonly end: number}} {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const next = value.slice(0, start) + insert + value.slice(end);
  const cursor = start + insert.length;
  return {next, selection: {start: cursor, end: cursor}};
}
