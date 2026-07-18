/**
 * Composer `@路径` 高亮分段（纯函数，无 RN/主题依赖）。
 */

const AT_TOKEN_RE = /@([^\s@]+)/g;

/** 高亮分段：普通文本或 `@token`。 */
export type ComposerAtPathSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'at-token'; readonly value: string };

/**
 * 将正文拆成普通文本与 `@path` 分段（纯函数，便于单测）。
 */
export function segmentComposerAtPathHighlight(
  text: string,
): ComposerAtPathSegment[] {
  if (text === '') {
    return [];
  }
  const segments: ComposerAtPathSegment[] = [];
  let last = 0;
  AT_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AT_TOKEN_RE.exec(text)) != null) {
    if (match.index > last) {
      segments.push({ kind: 'text', value: text.slice(last, match.index) });
    }
    segments.push({ kind: 'at-token', value: match[0]! });
    last = match.index + match[0]!.length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', value: text.slice(last) });
  }
  return segments;
}
