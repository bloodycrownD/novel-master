/**
 * 批注宽松行列 / offset：以磁盘源文件为坐标系，采集选区窗口并裁剪源文本。
 * 供 Desktop / Mobile 加草稿写入；预览锚注入见 `annotate-source-anchor`。
 *
 * @module domain/chat/logic/annotate-source-range
 */

/** 默认行向 padding（±N 行，H6 / A10）。 */
export const ANNOTATE_SOFT_RANGE_LINE_PADDING = 2;

/**
 * 默认字符向 padding（两侧各 N 个 UTF-16 code unit，A10）。
 * 合并顺序：精确半开 offset → 先 ±CHAR → 再 ±LINE → 写回半开 offset。
 */
export const ANNOTATE_SOFT_RANGE_CHAR_PADDING = 32;

/** 源文件半开 offset 窗口（UTF-16；`[startOffset, endOffset)`）。 */
export type AnnotateSoftOffsetRange = {
  readonly startOffset: number;
  readonly endOffset: number;
};

/**
 * 源文件宽松行列窗口（1-based；行闭区间）。
 * 列缺省表示整行；窗口可大于真实选区。
 */
export type AnnotateSoftSourceRange = {
  readonly startLine: number;
  readonly endLine: number;
  readonly startCol?: number;
  readonly endCol?: number;
};

/** 草稿 / DTO 上可能缺省的行列字段。 */
export type AnnotateSoftRangeFields = {
  readonly startLine?: number;
  readonly endLine?: number;
  readonly startCol?: number;
  readonly endCol?: number;
};

/**
 * 是否具备可用于窗口匹配的有效行区间（正整数且 start≤end）。
 * 仅有列或非法行 → false（走全文匹配）。
 */
export function hasValidAnnotateSoftRange(
  range: AnnotateSoftRangeFields | null | undefined,
): range is AnnotateSoftSourceRange {
  if (range == null) {
    return false;
  }
  const { startLine, endLine } = range;
  return (
    typeof startLine === "number" &&
    typeof endLine === "number" &&
    Number.isInteger(startLine) &&
    Number.isInteger(endLine) &&
    startLine > 0 &&
    endLine > 0 &&
    startLine <= endLine
  );
}

/** 将源文件按行拆分（行内容不含换行符；末行可无换行）。 */
export function splitSourceLines(sourceText: string): string[] {
  if (sourceText.length === 0) {
    return [""];
  }
  return sourceText.split(/\r\n|\n|\r/);
}

/**
 * 0-based 字符偏移 → 1-based 行列。
 * offset 钳制到 [0, length]。
 */
export function offsetToSourceLineCol(
  sourceText: string,
  offset: number,
): { readonly line: number; readonly col: number } {
  const clamped = Math.max(0, Math.min(offset, sourceText.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < clamped; i++) {
    const ch = sourceText[i]!;
    if (ch === "\r") {
      if (sourceText[i + 1] === "\n") {
        i++;
      }
      line++;
      col = 1;
    } else if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function lineStartOffsets(
  sourceText: string,
  lines: readonly string[],
): number[] {
  const offsets: number[] = [];
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets.push(off);
    off += lines[i]!.length;
    if (i < lines.length - 1) {
      if (sourceText[off] === "\r") {
        off++;
        if (sourceText[off] === "\n") {
          off++;
        }
      } else if (sourceText[off] === "\n") {
        off++;
      }
    }
  }
  return offsets;
}

/**
 * 对精确行列施加 ±padding，钳制到文件行数。
 * 若 padding 使起止行外扩，则去掉对应侧列（整行语义）。
 */
export function applySoftRangeLinePadding(
  exact: AnnotateSoftSourceRange,
  totalLines: number,
  linePadding: number = ANNOTATE_SOFT_RANGE_LINE_PADDING,
): AnnotateSoftSourceRange {
  const pad = Math.max(0, Math.floor(linePadding));
  const maxLine = Math.max(1, totalLines);
  const startLine = Math.max(1, exact.startLine - pad);
  const endLine = Math.min(maxLine, exact.endLine + pad);
  const out: {
    startLine: number;
    endLine: number;
    startCol?: number;
    endCol?: number;
  } = { startLine, endLine };
  if (startLine === exact.startLine && exact.startCol != null) {
    out.startCol = exact.startCol;
  }
  if (endLine === exact.endLine && exact.endCol != null) {
    out.endCol = exact.endCol;
  }
  return out;
}

/**
 * 由半开 offset 派生 1-based 行列（行闭区间；不做 padding）。
 * `endOffset` 为不含端点，结束行列取 `endOffset - 1` 处字符。
 */
export function deriveSoftRangeFieldsFromOffsets(
  sourceText: string,
  startOffset: number,
  endOffset: number,
): AnnotateSoftSourceRange {
  const lo = Math.min(startOffset, endOffset);
  const hi = Math.max(startOffset, endOffset);
  const startOff = Math.max(0, Math.min(lo, sourceText.length));
  const endOff = Math.max(startOff, Math.min(hi, sourceText.length));
  const start = offsetToSourceLineCol(sourceText, startOff);
  const endInclusive =
    endOff > startOff
      ? offsetToSourceLineCol(sourceText, endOff - 1)
      : start;
  return {
    startLine: start.line,
    endLine: endInclusive.line,
    startCol: start.col,
    endCol: endInclusive.col,
  };
}

/**
 * plain 选区：由源文件 0-based 半开偏移换算宽松行列（含默认行向 padding）。
 */
export function estimateSoftRangeFromPlainOffsets(
  sourceText: string,
  selectionStart: number,
  selectionEnd: number,
  options?: { readonly linePadding?: number },
): AnnotateSoftSourceRange {
  const exact = deriveSoftRangeFieldsFromOffsets(
    sourceText,
    selectionStart,
    selectionEnd,
  );
  const lines = splitSourceLines(sourceText);
  return applySoftRangeLinePadding(
    exact,
    lines.length,
    options?.linePadding ?? ANNOTATE_SOFT_RANGE_LINE_PADDING,
  );
}

/**
 * plain 选区 → 写入权威的宽松半开 offset（A10）。
 *
 * 合并顺序（钉死）：精确半开 → 先 ±`ANNOTATE_SOFT_RANGE_CHAR_PADDING`（默认 32）
 * 并钳制到 `[0, sourceText.length]` → 再换算行列并施加 ±`LINE_PADDING` → 再换回半开 offset。
 */
export function estimateSoftOffsetRangeFromPlainOffsets(
  sourceText: string,
  selectionStart: number,
  selectionEnd: number,
  options?: {
    readonly charPadding?: number;
    readonly linePadding?: number;
  },
): AnnotateSoftOffsetRange {
  const charPad = Math.max(
    0,
    Math.floor(options?.charPadding ?? ANNOTATE_SOFT_RANGE_CHAR_PADDING),
  );
  const lo = Math.min(selectionStart, selectionEnd);
  const hi = Math.max(selectionStart, selectionEnd);
  let startOff = Math.max(0, Math.min(lo, sourceText.length));
  let endOff = Math.max(startOff, Math.min(hi, sourceText.length));
  startOff = Math.max(0, startOff - charPad);
  endOff = Math.min(sourceText.length, endOff + charPad);
  const softRange = estimateSoftRangeFromPlainOffsets(
    sourceText,
    startOff,
    endOff,
    { linePadding: options?.linePadding },
  );
  const sliced = sliceSourceBySoftRange(sourceText, softRange);
  return {
    startOffset: sliced.startOffset,
    endOffset: sliced.startOffset + sliced.text.length,
  };
}

/**
 * MD / 无偏移：在源文件中定位 originalText 首次出现，再加 padding。
 * 找不到 → null。
 */
export function estimateSoftRangeFromOriginalText(
  sourceText: string,
  originalText: string,
  options?: { readonly linePadding?: number },
): AnnotateSoftSourceRange | null {
  const needle = originalText.replace(/\u00a0/g, " ");
  if (needle.length === 0) {
    return null;
  }
  let at = sourceText.indexOf(needle);
  let matchLen = needle.length;
  let haystack = sourceText;
  if (at < 0) {
    const normSource = sourceText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const normNeedle = needle.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    at = normSource.indexOf(normNeedle);
    if (at < 0) {
      return null;
    }
    matchLen = normNeedle.length;
    haystack = normSource;
  }
  return estimateSoftRangeFromPlainOffsets(
    haystack,
    at,
    at + matchLen,
    options,
  );
}

/**
 * 再扩大一次行窗口（匹配失败后的二次尝试，H5）。
 * 相对当前窗口再 ±padding；扩大时丢弃列。
 */
export function expandSoftRangeOnce(
  range: AnnotateSoftSourceRange,
  sourceText: string,
  options?: { readonly linePadding?: number },
): AnnotateSoftSourceRange {
  const lines = splitSourceLines(sourceText);
  return applySoftRangeLinePadding(
    { startLine: range.startLine, endLine: range.endLine },
    lines.length,
    options?.linePadding ?? ANNOTATE_SOFT_RANGE_LINE_PADDING,
  );
}

/**
 * 按宽松行列裁剪源文本。
 * 行闭区间；列缺省则整行。返回切片与其在全文中的 0-based 起始偏移。
 */
export function sliceSourceBySoftRange(
  sourceText: string,
  range: AnnotateSoftSourceRange,
): { readonly text: string; readonly startOffset: number } {
  const lines = splitSourceLines(sourceText);
  if (lines.length === 0) {
    return { text: "", startOffset: 0 };
  }
  const starts = lineStartOffsets(sourceText, lines);
  const startLine = Math.max(1, Math.min(range.startLine, lines.length));
  const endLine = Math.max(
    startLine,
    Math.min(range.endLine, lines.length),
  );
  const startLineText = lines[startLine - 1]!;
  const endLineText = lines[endLine - 1]!;
  let from = starts[startLine - 1]!;
  if (range.startCol != null) {
    from += Math.min(Math.max(range.startCol - 1, 0), startLineText.length);
  }
  let to = starts[endLine - 1]! + endLineText.length;
  if (range.endCol != null) {
    to =
      starts[endLine - 1]! +
      Math.min(Math.max(range.endCol, 0), endLineText.length);
  }
  if (from > to) {
    to = from;
  }
  return {
    text: sourceText.slice(from, to),
    startOffset: from,
  };
}
