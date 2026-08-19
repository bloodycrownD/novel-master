/**
 * 用户气泡正文：`@路径` / `$技能` token 渲染为圆角胶囊（与 composer tag 视觉对齐）。
 *
 * 切分口径与 core 扫描同构：
 * - `@` 后至空白/`@`（scanAtPathAttachments 的 AT_PATH_TOKEN_RE）
 * - `$` 需空白边界、token 非空白/`$`/`/`/`@` 且首字符非 `.`（scanSkillAttachments
 *   字符集 + SKILL_NAME_PATTERN 首字符约束）
 */
import type { ComponentChildren } from 'preact';

const AT_PATH_TOKEN_RE = /@([^\s@]+)/g;
const SKILL_TOKEN_RE = /(?<!\S)\$([^\s$/@]+)/g;

type RefSpan =
  | { kind: 'text'; text: string }
  | { kind: 'path' | 'skill'; text: string };

/** 正文按 token 切分为普通文本 / 引用胶囊片段（无 token 时原样单段）。 */
export function splitRefTokenSpans(text: string): RefSpan[] {
  type Match = { index: number; end: number; text: string; kind: 'path' | 'skill' };
  const matches: Match[] = [];
  AT_PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AT_PATH_TOKEN_RE.exec(text)) != null) {
    matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'path' });
  }
  SKILL_TOKEN_RE.lastIndex = 0;
  while ((m = SKILL_TOKEN_RE.exec(text)) != null) {
    // 首字符 `.` 不是合法技能名（SKILL_NAME_PATTERN）：视作正文
    if (m[1]!.startsWith('.')) continue;
    matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], kind: 'skill' });
  }
  matches.sort((a, b) => a.index - b.index);

  const spans: RefSpan[] = [];
  let cursor = 0;
  for (const match of matches) {
    // 理论上两类 token 字符集互斥不会重叠；防御性跳过
    if (match.index < cursor) continue;
    if (match.index > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    spans.push({ kind: match.kind, text: match.text });
    cursor = match.end;
  }
  if (cursor < text.length) {
    spans.push({ kind: 'text', text: text.slice(cursor) });
  }
  return spans;
}

/** 用户气泡正文渲染：引用 token 套胶囊样式，其余原样。 */
export function RefTokenText({ text }: { text: string }): ComponentChildren {
  const spans = splitRefTokenSpans(text);
  if (spans.length === 0) {
    return null;
  }
  return (
    <>
      {spans.map((span, index) =>
        span.kind === 'text' ? (
          span.text
        ) : (
          <span key={`ref-${index}`} className={`ref-token ref-token--${span.kind}`}>
            {span.text}
          </span>
        ),
      )}
    </>
  );
}
