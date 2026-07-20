/**
 * Mobile mention 专属：controlled-mentions 内部格式 ↔ 对外纯字符串 `@/path`。
 * 禁止进 core（T-X2-2）。
 */
import {
  generateValueFromMentionStateAndChangedText,
  parseValue,
  replaceTriggerValues,
  type TriggersConfig,
} from 'react-native-controlled-mentions';

/** 与 controlled-mentions 默认 trigger 同形；name/id 均为逻辑 path（含前导 `/`）。 */
export type ComposerAtPathTriggersConfig = TriggersConfig<'atPath'>;

/** mention 内部值 → 对外纯字符串（`{@}[path](id)` → `@path`）。 */
export function mentionValueToPlain(mentionValue: string): string {
  return replaceTriggerValues(mentionValue, ({ name }) => `@${name}`);
}

/** `@/path` token → mention suggestion（name/id = 逻辑 path）。 */
export function suggestionFromAtPathToken(token: string): {
  id: string;
  name: string;
} {
  const path = token.startsWith('@') ? token.slice(1) : token;
  return { id: path, name: path };
}

/** 默认 mention 标记串（与库 getTriggerValue 同形）。 */
export function formatAtPathMentionMarkup(path: string): string {
  return `{@}[${path}](${path})`;
}

/**
 * 单次连续删除若碰到 mention 区间，整段删掉（库无官方原子删）。
 * @returns 新的 mention value；无需原子删时返回 null
 */
export function tryAtomicMentionDelete(
  mentionValue: string,
  changedPlain: string,
  triggersConfig: ComposerAtPathTriggersConfig,
): string | null {
  const configs = [triggersConfig.atPath];
  const state = parseValue(mentionValue, configs);
  const { parts, plainText } = state;
  if (changedPlain.length >= plainText.length) {
    return null;
  }

  let prefix = 0;
  const minLen = Math.min(changedPlain.length, plainText.length);
  while (prefix < minLen && changedPlain[prefix] === plainText[prefix]) {
    prefix++;
  }
  const deletedCount = plainText.length - changedPlain.length;
  const deleteStart = prefix;
  const deleteEnd = deleteStart + deletedCount;
  const afterOld = plainText.slice(deleteEnd);
  const afterNew = changedPlain.slice(deleteStart);
  if (afterOld !== afterNew) {
    return null;
  }

  const mentionPart = parts.find(
    p =>
      p.data != null &&
      deleteStart < p.position.end &&
      deleteEnd > p.position.start,
  );
  if (mentionPart == null) {
    return null;
  }
  // 已覆盖整段 mention：交给库默认差分即可
  if (
    deleteStart <= mentionPart.position.start &&
    deleteEnd >= mentionPart.position.end
  ) {
    return null;
  }

  const nextPlain =
    plainText.slice(0, mentionPart.position.start) +
    plainText.slice(mentionPart.position.end);
  return generateValueFromMentionStateAndChangedText(state, nextPlain);
}

/**
 * 程序化写入纯文本：保留既有 mention；仅在新增片段内把完整 `@path` 提成 mention。
 * 手输已存在的纯文本 `@/path` 落在未改区间，不会被提升。
 */
export function mergeProgrammaticPlainIntoMentionValue(
  prevMentionValue: string,
  nextPlain: string,
  triggersConfig: ComposerAtPathTriggersConfig,
): string {
  const configs = [triggersConfig.atPath];
  const prev = parseValue(prevMentionValue, configs);
  if (prev.plainText === nextPlain) {
    return prevMentionValue;
  }

  const baseValue = generateValueFromMentionStateAndChangedText(prev, nextPlain);
  const added = findSingleAddedRange(prev.plainText, nextPlain);
  if (added == null) {
    return baseValue;
  }
  return promotePlainAtPathsInRange(baseValue, triggersConfig, added);
}

/** 前缀/后缀对齐下的单段新增（选择器插入 / typeahead 替换的常见形）。 */
function findSingleAddedRange(
  prev: string,
  next: string,
): { start: number; end: number } | null {
  let prefix = 0;
  while (prefix < prev.length && prefix < next.length && prev[prefix] === next[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const start = prefix;
  const end = next.length - suffix;
  if (start >= end) {
    return null;
  }
  return { start, end };
}

/**
 * 在 plain 坐标 `[start,end)` 内，把完整 `@path` 纯文本片段提成 mention markup。
 */
function promotePlainAtPathsInRange(
  mentionValue: string,
  triggersConfig: ComposerAtPathTriggersConfig,
  range: { start: number; end: number },
): string {
  const plain = mentionValueToPlain(mentionValue);
  const slice = plain.slice(range.start, range.end);
  // 与 scan / 历史 token 同口径：@ + 非空白非 @
  const tokenRe = /@([^\s@]+)/g;
  const promotions: Array<{ absStart: number; absEnd: number; path: string }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(slice)) != null) {
    const absStart = range.start + m.index;
    const absEnd = absStart + m[0]!.length;
    // 边界：行首或空白/(
    if (absStart > 0) {
      const prevCh = plain[absStart - 1]!;
      if (prevCh !== ' ' && prevCh !== '\n' && prevCh !== '\t' && prevCh !== '(') {
        continue;
      }
    }
    promotions.push({ absStart, absEnd, path: m[1]! });
  }
  if (promotions.length === 0) {
    return mentionValue;
  }

  // 按 plain 坐标把「已是 mention 的区间」与「待提升」合并重建 markup
  const state = parseValue(mentionValue, [triggersConfig.atPath]);
  const mentionSpans = state.parts
    .filter(p => p.data != null)
    .map(p => ({
      start: p.position.start,
      end: p.position.end,
      original: p.data!.original,
    }));

  type Span =
    | { kind: 'mention'; start: number; end: number; original: string }
    | { kind: 'promote'; start: number; end: number; path: string };
  const spans: Span[] = [
    ...mentionSpans.map(s => ({
      kind: 'mention' as const,
      start: s.start,
      end: s.end,
      original: s.original,
    })),
    ...promotions
      .filter(
        p =>
          !mentionSpans.some(
            s => p.absStart < s.end && p.absEnd > s.start,
          ),
      )
      .map(p => ({
        kind: 'promote' as const,
        start: p.absStart,
        end: p.absEnd,
        path: p.path,
      })),
  ].sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) {
      continue;
    }
    out += plain.slice(cursor, span.start);
    if (span.kind === 'mention') {
      out += span.original;
    } else {
      out += formatAtPathMentionMarkup(span.path);
    }
    cursor = span.end;
  }
  out += plain.slice(cursor);
  return out;
}
