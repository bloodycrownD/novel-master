/**
 * Shared output limits for read / grep / glob / chat_grep / fs ls tools.
 *
 * @module domain/tool/logic/tool-output-limits
 */

export const TOOL_OUTPUT_MAX_LINES = 2000;
export const TOOL_OUTPUT_MAX_LINE_LENGTH = 2000;
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;
export const TOOL_OUTPUT_MAX_MATCHES = 100;
export const TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX =
  `... (line truncated to ${TOOL_OUTPUT_MAX_LINE_LENGTH} chars)`;

/** UTF-8 byte length without Node `Buffer` (RN/Hermes has no global Buffer). */
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Truncates a single line when it exceeds {@link TOOL_OUTPUT_MAX_LINE_LENGTH}. */
export function truncateLine(
  text: string,
  maxLen: number = TOOL_OUTPUT_MAX_LINE_LENGTH,
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
  limit: number = TOOL_OUTPUT_MAX_LINES,
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
  maxBytes: number = TOOL_OUTPUT_MAX_BYTES,
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
 * Caps a match list by count, then by UTF-8 bytes of formatted items.
 *
 * @param formatItem Serializes each item for byte accounting (e.g. JSON line).
 */
export function capMatchList<T>(
  items: readonly T[],
  maxItems: number = TOOL_OUTPUT_MAX_MATCHES,
  formatItem: (item: T) => string,
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
