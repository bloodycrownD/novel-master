/**
 * 源范围钉点 → 注入锚 → 内存派生串（不写盘）。
 * `mode: "text"` 单壳；`mode: "markdown"` 按下划线可渲染单元多壳同 id。
 *
 * **非预览投影合同**（SPEC R5）：本模块可暂留实现供测试/兼容；
 * 宿主 MD/plain 预览主路径禁止调用 {@link buildAnnotatedSource}。
 * 预览高亮唯一走 Recogito + 草稿 `renderStart`/`renderEnd`。
 *
 * @module domain/chat/logic/annotate-source-anchor
 */

import { normalizeAnnotateNeedle } from "./annotate-highlight.js";
import type { AnnotateDraft } from "../model/annotate-draft.schema.js";

/** 锚 class（A5）。 */
export const ANNOTATE_ANCHOR_CLASS = "nm-annotate-anchor";

/** 注锚派生模式（A4）；非预览投影主路径。 */
export type BuildAnnotatedSourceMode = "text" | "markdown";

/** {@link buildAnnotatedSource} 入参（非预览投影合同）。 */
export type BuildAnnotatedSourceInput = {
  /** VFS 全文（含 FM）；见 A15 */
  readonly sourceText: string;
  readonly drafts: readonly AnnotateDraft[];
  readonly mode: BuildAnnotatedSourceMode;
};

/** {@link buildAnnotatedSource} 出参（非预览投影合同）。 */
export type BuildAnnotatedSourceResult = {
  /** 仅内存；含锚 HTML 子集，不写盘；同 drafts 下 text/markdown 可不同 */
  readonly annotatedSource: string;
  /** 校验失败 / 重叠 skip / 代码绕开等未注入的 draft id */
  readonly skippedDraftIds: readonly string[];
};

type HalfOpen = { readonly start: number; readonly end: number };

type AnchorPiece = {
  readonly start: number;
  readonly end: number;
  readonly id: string;
};

/** 草稿是否具备可用半开 offset（相对给定全文长度）。 */
export function hasValidAnnotateOffsetRange(
  draft: Pick<AnnotateDraft, "startOffset" | "endOffset">,
  sourceLength: number,
): draft is {
  readonly startOffset: number;
  readonly endOffset: number;
} {
  const { startOffset, endOffset } = draft;
  return (
    typeof startOffset === "number" &&
    typeof endOffset === "number" &&
    Number.isInteger(startOffset) &&
    Number.isInteger(endOffset) &&
    startOffset >= 0 &&
    endOffset <= sourceLength &&
    startOffset < endOffset
  );
}

/** 转义源文本中的尖括号与 `&`，避免注入成真标签（XSS 合同）。 */
export function escapeAnnotateSourceText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAnnotateAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapAnchor(id: string, innerEscaped: string): string {
  return `<span class="${ANNOTATE_ANCHOR_CLASS}" data-annotate-id="${escapeAnnotateAttr(id)}">${innerEscaped}</span>`;
}

/**
 * A13：范围内源切片（归一后）须包含 `originalText`（归一后）；
 * 严重不符则跳过注入。
 */
export function annotateRangeMatchesOriginalText(
  sourceText: string,
  startOffset: number,
  endOffset: number,
  originalText: string,
): boolean {
  const needle = normalizeAnnotateNeedle(originalText);
  if (!needle) {
    return false;
  }
  const slice = sourceText.slice(startOffset, endOffset);
  const hay = slice
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return hay.includes(needle);
}

function intervalsOverlap(a: HalfOpen, b: HalfOpen): boolean {
  return a.start < b.end && b.start < a.end;
}

function isLineStart(source: string, index: number): boolean {
  if (index <= 0) {
    return true;
  }
  const prev = source[index - 1];
  return prev === "\n" || prev === "\r";
}

/**
 * 全文围栏代码块 + 行内代码半开区间（A8）。
 * 实现自决 tokenizer；满足代码内不注入即可。
 */
export function findMarkdownCodeRanges(source: string): HalfOpen[] {
  const out: HalfOpen[] = [];
  let i = 0;
  while (i < source.length) {
    if (
      isLineStart(source, i) &&
      (source.startsWith("```", i) || source.startsWith("~~~", i))
    ) {
      const fence = source.startsWith("```", i) ? "```" : "~~~";
      const lineEnd = indexOfLineEnd(source, i);
      let j = lineEnd;
      let closed = false;
      while (j < source.length) {
        if (isLineStart(source, j) && source.startsWith(fence, j)) {
          let k = j + fence.length;
          while (
            k < source.length &&
            (source[k] === " " || source[k] === "\t")
          ) {
            k++;
          }
          if (
            k >= source.length ||
            source[k] === "\n" ||
            source[k] === "\r"
          ) {
            const end = advancePastEol(source, k);
            out.push({ start: i, end });
            i = end;
            closed = true;
            break;
          }
        }
        j++;
      }
      if (!closed) {
        out.push({ start: i, end: source.length });
        break;
      }
      continue;
    }

    if (source[i] === "`") {
      let n = 0;
      while (i + n < source.length && source[i + n] === "`") {
        n++;
      }
      // 行首三反引号已在上方处理；此处跳过可能的围栏开标记误伤
      if (n >= 3 && isLineStart(source, i)) {
        i += n;
        continue;
      }
      const close = findClosingBackticks(source, i + n, n);
      if (close >= 0) {
        out.push({ start: i, end: close + n });
        i = close + n;
        continue;
      }
    }
    i++;
  }
  return out;
}

function indexOfLineEnd(source: string, from: number): number {
  for (let i = from; i < source.length; i++) {
    if (source[i] === "\n") {
      return i + 1;
    }
    if (source[i] === "\r") {
      return source[i + 1] === "\n" ? i + 2 : i + 1;
    }
  }
  return source.length;
}

function advancePastEol(source: string, at: number): number {
  if (at >= source.length) {
    return source.length;
  }
  if (source[at] === "\r") {
    return source[at + 1] === "\n" ? at + 2 : at + 1;
  }
  if (source[at] === "\n") {
    return at + 1;
  }
  return at;
}

function findClosingBackticks(
  source: string,
  from: number,
  tickCount: number,
): number {
  const needle = "`".repeat(tickCount);
  let at = from;
  while (at < source.length) {
    const hit = source.indexOf(needle, at);
    if (hit < 0) {
      return -1;
    }
    // 两侧不能紧贴更多反引号（简化 CommonMark 规则）
    const beforeOk = hit === 0 || source[hit - 1] !== "`";
    const after = hit + tickCount;
    const afterOk = after >= source.length || source[after] !== "`";
    if (beforeOk && afterOk) {
      return hit;
    }
    at = hit + 1;
  }
  return -1;
}

function inAnyRange(index: number, ranges: readonly HalfOpen[]): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

function emphasisDelimiterLength(source: string, index: number): number {
  if (source.startsWith("**", index) || source.startsWith("__", index)) {
    return 2;
  }
  const ch = source[index];
  if (ch === "*" || ch === "_") {
    return 1;
  }
  return 0;
}

function skipLinkDestination(source: string, from: number, limit: number): number {
  // 从 `](` 起跳到匹配 `)`
  let i = from;
  if (i + 1 >= limit || source[i] !== "]" || source[i + 1] !== "(") {
    return Math.min(from + 1, limit);
  }
  i += 2;
  let depth = 1;
  while (i < limit && depth > 0) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    }
    i++;
  }
  return i;
}

/**
 * 在 `[rangeStart, rangeEnd)` 内切出可画下划线的纯文本 run（A7）。
 * 定界符 / 链接目标 / 代码内容不进入 run。
 */
export function splitMarkdownUnderlineRuns(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  codeRanges: readonly HalfOpen[],
): HalfOpen[] {
  const runs: HalfOpen[] = [];
  let runStart = -1;

  const flush = (end: number): void => {
    if (runStart >= 0 && end > runStart) {
      runs.push({ start: runStart, end });
    }
    runStart = -1;
  };

  let i = rangeStart;
  while (i < rangeEnd) {
    if (inAnyRange(i, codeRanges)) {
      flush(i);
      const cr = codeRanges.find((r) => i >= r.start && i < r.end)!;
      i = Math.min(cr.end, rangeEnd);
      continue;
    }

    if (source[i] === "!" && i + 1 < rangeEnd && source[i + 1] === "[") {
      flush(i);
      i += 2;
      continue;
    }

    if (source[i] === "[") {
      flush(i);
      i += 1;
      continue;
    }

    if (source[i] === "]" && i + 1 < rangeEnd && source[i + 1] === "(") {
      flush(i);
      i = skipLinkDestination(source, i, rangeEnd);
      continue;
    }

    const delim = emphasisDelimiterLength(source, i);
    if (delim > 0) {
      flush(i);
      i += delim;
      continue;
    }

    if (runStart < 0) {
      runStart = i;
    }
    i += 1;
  }
  flush(rangeEnd);
  return runs;
}

function collectPiecesForDraft(
  sourceText: string,
  draft: AnnotateDraft & { startOffset: number; endOffset: number },
  mode: BuildAnnotatedSourceMode,
  codeRanges: readonly HalfOpen[],
): AnchorPiece[] | null {
  const { startOffset, endOffset, id } = draft;
  if (mode === "text") {
    return [{ start: startOffset, end: endOffset, id }];
  }

  // 选区完全落在代码内 → 整段跳过（T-SA5）
  const fullyInCode = codeRanges.some(
    (r) => startOffset >= r.start && endOffset <= r.end,
  );
  if (fullyInCode) {
    return null;
  }

  const runs = splitMarkdownUnderlineRuns(
    sourceText,
    startOffset,
    endOffset,
    codeRanges,
  );
  if (runs.length === 0) {
    return null;
  }
  return runs.map((r) => ({ start: r.start, end: r.end, id }));
}

/**
 * 由 VFS 原文 + drafts 生成仅内存的带锚派生串（A4–A8、A13）。
 * 多草稿按 `startOffset` 升序；v1 重叠禁止注入（记入 `skippedDraftIds`，保留草稿）。
 *
 * **禁止**宿主 MD/plain 预览主路径调用（SPEC R5）；
 * 预览投影权威为 Recogito 渲染坐标（`renderStart`/`renderEnd`），非本函数输出。
 */
export function buildAnnotatedSource(
  input: BuildAnnotatedSourceInput,
): BuildAnnotatedSourceResult {
  const { sourceText, drafts, mode } = input;
  const skippedDraftIds: string[] = [];
  const committed: HalfOpen[] = [];
  const pieces: AnchorPiece[] = [];

  const codeRanges =
    mode === "markdown" ? findMarkdownCodeRanges(sourceText) : [];

  const ordered = [...drafts].sort((a, b) => {
    const as = a.startOffset ?? Number.POSITIVE_INFINITY;
    const bs = b.startOffset ?? Number.POSITIVE_INFINITY;
    if (as !== bs) {
      return as - bs;
    }
    return a.id.localeCompare(b.id);
  });

  for (const draft of ordered) {
    if (!hasValidAnnotateOffsetRange(draft, sourceText.length)) {
      // 无 offset / 越界：A12 不注入；不记入 skipped（非校验/重叠/代码绕开）
      continue;
    }
    const range: HalfOpen = {
      start: draft.startOffset,
      end: draft.endOffset,
    };
    if (
      !annotateRangeMatchesOriginalText(
        sourceText,
        range.start,
        range.end,
        draft.originalText,
      )
    ) {
      skippedDraftIds.push(draft.id);
      continue;
    }
    if (committed.some((c) => intervalsOverlap(c, range))) {
      skippedDraftIds.push(draft.id);
      continue;
    }
    const draftPieces = collectPiecesForDraft(
      sourceText,
      draft,
      mode,
      codeRanges,
    );
    if (draftPieces == null || draftPieces.length === 0) {
      skippedDraftIds.push(draft.id);
      continue;
    }
    committed.push(range);
    pieces.push(...draftPieces);
  }

  pieces.sort((a, b) => a.start - b.start || a.end - b.end);

  let out = "";
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.start < cursor) {
      // 防御：同草稿多壳不应重叠；跨草稿已 skip
      continue;
    }
    if (piece.start > cursor) {
      out += escapeAnnotateSourceText(sourceText.slice(cursor, piece.start));
    }
    out += wrapAnchor(
      piece.id,
      escapeAnnotateSourceText(sourceText.slice(piece.start, piece.end)),
    );
    cursor = piece.end;
  }
  if (cursor < sourceText.length) {
    out += escapeAnnotateSourceText(sourceText.slice(cursor));
  }

  return { annotatedSource: out, skippedDraftIds };
}
