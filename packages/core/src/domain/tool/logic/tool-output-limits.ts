/**
 * Shared output limits for read / grep / glob / chat_grep / fs ls tools.
 *
 * @module domain/tool/logic/tool-output-limits
 */

import { Encoding } from "@/common/encoding.js";
import { Text } from "@/common/text.js";

export const TOOL_OUTPUT_MAX_LINES = 2000;
export const TOOL_OUTPUT_MAX_LINE_LENGTH = 2000;
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;
export const TOOL_OUTPUT_MAX_MATCHES = 100;
const TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX = `... (line truncated to ${TOOL_OUTPUT_MAX_LINE_LENGTH} chars)`;

/** 行级字节预算口径选项。 */
export interface CapUtf8BytesOptions {
  /**
   * true = 剩余预算装不下一整行时，末行截到预算点（不切半个字符）而非整行丢弃
   * （read 场景单行可达几百 KB：minified JSON / 无换行 HTML，整行丢弃会一行都留不下）；
   * false（缺省）= 整行丢弃（fs ls / grep excerpt / skill 路径口径）。
   */
  readonly fillLastLine?: boolean;
}

export const ToolOutputLimits = {
  /** Truncates a single line when it exceeds {@link TOOL_OUTPUT_MAX_LINE_LENGTH}. */
  truncateLine(text: string, maxLen: number = TOOL_OUTPUT_MAX_LINE_LENGTH): { readonly line: string; readonly truncated: boolean } {
    if (text.length <= maxLen) {
      return { line: text, truncated: false };
    }
    return {
      line: text.slice(0, maxLen) + TOOL_OUTPUT_LINE_TRUNCATED_SUFFIX,
      truncated: true,
    };
  },

  /**
   * Slices lines from a 1-based offset with a line count limit.
   *
   * @returns `nextOffset` when more lines remain beyond the slice.
   */
  sliceLinesFromOffset(lines: readonly string[], offset1Based: number, limit: number = TOOL_OUTPUT_MAX_LINES): {
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
  },

  /** Stops accumulating lines once UTF-8 byte budget would be exceeded. */
  capUtf8Bytes(lines: readonly string[], maxBytes: number = TOOL_OUTPUT_MAX_BYTES, options: CapUtf8BytesOptions = {}): {
    readonly lines: readonly string[];
    readonly truncated: boolean;
    readonly bytesUsed: number;
    /** true = 末行仅保留字节前缀（该行不完整，尾部不可续读）；仅 fillLastLine 口径会命中。 */
    readonly lastLinePartial: boolean;
  } {
    const result: string[] = [];
    let bytesUsed = 0;
    let truncated = false;
    let lastLinePartial = false;

    for (const line of lines) {
      const lineBytes = Encoding.utf8ByteLength(line);
      const separatorBytes = result.length > 0 ? 1 : 0;
      if (bytesUsed + separatorBytes + lineBytes <= maxBytes) {
        bytesUsed += separatorBytes + lineBytes;
        result.push(line);
        continue;
      }
      truncated = true;
      if (options.fillLastLine === true) {
        // 该行装不进剩余预算：截到预算点；剩余预算装不下一个字符（如 0）
        // 时整行不保留，从下一轮 read 的预算重置中重读。
        const remaining = maxBytes - bytesUsed - separatorBytes;
        if (remaining > 0) {
          const prefix = Text.sliceUtf8Bytes(line, remaining);
          if (prefix.length > 0) {
            result.push(prefix);
            lastLinePartial = true;
          }
        }
      }
      // WHY: 非填满口径 stop before exceeding budget — partial line inclusion would mislead the model.
      break;
    }

    return { lines: result, truncated, bytesUsed, lastLinePartial };
  },

  /** 末行填满口径的命名入口（read 工具 + 测试按名锁定）：等价 `capUtf8Bytes(lines, maxBytes, {fillLastLine: true})`。 */
  // nm-style: keep-public — 测试与 vfs read 工具按名消费此口径；实现已合并进 capUtf8Bytes。
  capUtf8BytesFill(lines: readonly string[], maxBytes: number = TOOL_OUTPUT_MAX_BYTES): {
    readonly lines: readonly string[];
    readonly truncated: boolean;
    readonly bytesUsed: number;
    readonly lastLinePartial: boolean;
  } {
    return ToolOutputLimits.capUtf8Bytes(lines, maxBytes, {fillLastLine: true});
  },

  /**
   * Caps a match list by count, then by UTF-8 bytes of formatted items.
   *
   * @param formatItem Serializes each item for byte accounting (e.g. JSON line).
   */
  capMatchList<T>(items: readonly T[], maxItems: number = TOOL_OUTPUT_MAX_MATCHES, formatItem: (item: T) => string): {
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
      const lineBytes = Encoding.utf8ByteLength(formatted);
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
  },
} as const;
