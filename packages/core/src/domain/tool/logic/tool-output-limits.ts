/**
 * Shared output limits for read / grep / glob / chat_grep / fs ls tools.
 *
 * @module domain/tool/logic/tool-output-limits
 */

export const TOOL_OUTPUT_MAX_LINES = 2000;
export const TOOL_OUTPUT_MAX_LINE_LENGTH = 2000;
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;
export const TOOL_OUTPUT_MAX_MATCHES = 100;
export const TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX = `... (line truncated to ${TOOL_OUTPUT_MAX_LINE_LENGTH} chars)`;

/** UTF-8 byte length without Node `Buffer` (RN/Hermes has no global Buffer). */
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Truncates a single line when it exceeds {@link TOOL_OUTPUT_MAX_LINE_LENGTH}. */
export function truncateLine(
  text: string,
  maxLen: number = TOOL_OUTPUT_MAX_LINE_LENGTH
): { readonly line: string; readonly truncated: boolean } {
  if (text.length <= maxLen) {
    return { line: text, truncated: false };
  }
  return {
    line: text.slice(0, maxLen) + TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX,
    truncated: true,
  };
}

/**
 * Slices lines from a 1-based offset with a line count limit.
 *
 * @returns `nextOffset` when more lines remain beyond the slice.
 */
export function sliceLinesFromOffset(
  lines: readonly string[],
  offset1Based: number,
  limit: number = TOOL_OUTPUT_MAX_LINES
): {
  readonly slice: readonly string[];
  readonly totalLines: number;
  readonly nextOffset?: number;
} {
  const totalLines = lines.length;
  const startIdx = Math.max(0, offset1Based - 1);
  const endIdx = Math.min(startIdx + limit, totalLines);
  const slice = lines.slice(startIdx, endIdx);
  const nextOffset = endIdx < totalLines ? endIdx + 1 : undefined;
  return { slice, totalLines, nextOffset };
}

/** Stops accumulating lines once UTF-8 byte budget would be exceeded. */
export function capUtf8Bytes(
  lines: readonly string[],
  maxBytes: number = TOOL_OUTPUT_MAX_BYTES
): {
  readonly lines: readonly string[];
  readonly truncated: boolean;
  readonly bytesUsed: number;
} {
  const result: string[] = [];
  let bytesUsed = 0;
  let truncated = false;

  for (const line of lines) {
    const lineBytes = utf8ByteLength(line);
    const separatorBytes = result.length > 0 ? 1 : 0;
    if (bytesUsed + separatorBytes + lineBytes > maxBytes) {
      // WHY: stop before exceeding budget — partial line inclusion would mislead the model.
      truncated = true;
      break;
    }
    bytesUsed += separatorBytes + lineBytes;
    result.push(line);
  }

  return { lines: result, truncated, bytesUsed };
}

/**
 * Slices a UTF-8 byte prefix of `text` without splitting a character.
 *
 * 代理对成对推进（不切半个字符）；块式增量编码避免全量字符串一次性
 * 编码。预算 ≤ 0 时返回空串。
 */
export function sliceUtf8BytePrefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const encoder = new TextEncoder();
  const CHUNK = 8192;
  let used = 0;
  for (let i = 0; i < text.length; i += CHUNK) {
    const chunk = text.slice(i, Math.min(i + CHUNK, text.length));
    const chunkBytes = encoder.encode(chunk).byteLength;
    if (used + chunkBytes <= maxBytes) {
      used += chunkBytes;
      continue;
    }
    // 该块超预算：块内逐码位（代理对成对）推进，找到恰好装满预算的切点。
    for (let j = 0; j < chunk.length; ) {
      const codePoint = chunk.codePointAt(j)!;
      const charLength = codePoint > 0xffff ? 2 : 1;
      const charBytes = encoder.encode(
        String.fromCodePoint(codePoint)
      ).byteLength;
      if (used + charBytes > maxBytes) {
        return text.slice(0, i + j);
      }
      used += charBytes;
      j += charLength;
    }
    return text.slice(0, i + chunk.length);
  }
  return text;
}

/**
 * Fills the UTF-8 byte budget as much as possible（read 专用）。
 *
 * 与 {@link capUtf8Bytes} 的差异：剩余预算装不下一整行时，末行允许
 * 截到预算点（不切半个字符）而非整行丢弃——read 场景单行可以是
 * 几百 KB（minified JSON / 无换行 HTML），整行丢弃会一行都留不下。
 *
 * `lastLinePartial` 表示末行仅保留了字节前缀（该行不完整，尾部不可
 * 续读）；`truncated` 涵盖所有截断（末行部分保留、整行丢弃、后续行
 * 丢弃）。既有函数（capUtf8Bytes / truncateLine 等）不动——fs ls /
 * grep excerpt / skill 路径仍用旧口径。
 */
export function capUtf8BytesFill(
  lines: readonly string[],
  maxBytes: number = TOOL_OUTPUT_MAX_BYTES
): {
  readonly lines: readonly string[];
  readonly truncated: boolean;
  readonly bytesUsed: number;
  readonly lastLinePartial: boolean;
} {
  const result: string[] = [];
  let bytesUsed = 0;
  let truncated = false;
  let lastLinePartial = false;

  for (const line of lines) {
    const lineBytes = utf8ByteLength(line);
    const separatorBytes = result.length > 0 ? 1 : 0;
    if (bytesUsed + separatorBytes + lineBytes <= maxBytes) {
      bytesUsed += separatorBytes + lineBytes;
      result.push(line);
      continue;
    }
    // 该行装不进剩余预算：截到预算点；剩余预算装不下一个字符（如 0）
    // 时整行不保留，从下一轮 read 的预算重置中重读。
    truncated = true;
    const remaining = maxBytes - bytesUsed - separatorBytes;
    if (remaining > 0) {
      const prefix = sliceUtf8BytePrefix(line, remaining);
      if (prefix.length > 0) {
        result.push(prefix);
        lastLinePartial = true;
      }
    }
    break;
  }

  return { lines: result, truncated, bytesUsed, lastLinePartial };
}

/**
 * Caps a match list by count, then by UTF-8 bytes of formatted items.
 *
 * @param formatItem Serializes each item for byte accounting (e.g. JSON line).
 */
export function capMatchList<T>(
  items: readonly T[],
  maxItems: number = TOOL_OUTPUT_MAX_MATCHES,
  formatItem: (item: T) => string
): {
  readonly items: readonly T[];
  readonly total: number;
  readonly truncated: boolean;
} {
  const total = items.length;
  let truncated = total > maxItems;
  const countCapped = items.slice(0, maxItems);

  const kept: T[] = [];
  let bytesUsed = 0;
  for (const item of countCapped) {
    const formatted = formatItem(item);
    const lineBytes = utf8ByteLength(formatted);
    const separatorBytes = kept.length > 0 ? 1 : 0;
    if (bytesUsed + separatorBytes + lineBytes > TOOL_OUTPUT_MAX_BYTES) {
      truncated = true;
      break;
    }
    bytesUsed += separatorBytes + lineBytes;
    kept.push(item);
  }

  if (kept.length < countCapped.length) {
    truncated = true;
  }

  return { items: kept, total, truncated };
}
