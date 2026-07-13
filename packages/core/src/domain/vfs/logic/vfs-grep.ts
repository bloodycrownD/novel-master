/**
 * VFS 内容搜索（grep）逻辑：字面量 / 正则、过滤与上下文行。
 *
 * @module domain/vfs/logic/vfs-grep
 */

import type { VfsGrepMatch } from "../ports/vfs-service.port.js";

/** pattern 解释方式：auto 先尝试正则，失败则退化为字面量。 */
export type VfsGrepMatchMode = "auto" | "literal" | "regex";

export interface VfsGrepOptions {
  /** 仅搜索路径以此前缀开头的文件 */
  readonly pathPrefix?: string;
  /** 仅搜索路径匹配该 glob 的文件（如 **\/*.ts） */
  readonly pathGlob?: string;
  /** pattern 匹配模式；默认 auto */
  readonly matchMode?: VfsGrepMatchMode;
  /** 忽略大小写 */
  readonly caseInsensitive?: boolean;
  /** 为 true 时返回不匹配 pattern 的行 */
  readonly invert?: boolean;
  /** 命中行前后附带的上下文行数（写入 excerpt） */
  readonly contextLines?: number;
  /** 为 true 时每个文件至多返回一条命中 */
  readonly oneMatchPerFile?: boolean;
}

export type VfsGrepContentRow = {
  readonly path: string;
  readonly content: string;
};

type LineMatcher = {
  readonly lineMatches: (line: string) => boolean;
  readonly matchColumns: (line: string) => readonly number[];
};

function compileRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const flags = caseInsensitive ? "gi" : "g";
  return new RegExp(pattern, flags);
}

function createLineMatcher(
  pattern: string,
  options?: VfsGrepOptions,
): LineMatcher {
  const mode = options?.matchMode ?? "auto";
  const caseInsensitive = options?.caseInsensitive === true;

  let regex: RegExp | null = null;
  let literal: string | null = null;

  if (mode === "regex") {
    regex = compileRegex(pattern, caseInsensitive);
  } else if (mode === "literal") {
    literal = pattern;
  } else {
    try {
      regex = compileRegex(pattern, caseInsensitive);
    } catch {
      literal = pattern;
    }
  }

  if (regex != null) {
    return {
      lineMatches(line: string) {
        regex!.lastIndex = 0;
        return regex!.test(line);
      },
      matchColumns(line: string) {
        const columns: number[] = [];
        regex!.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex!.exec(line)) != null) {
          columns.push(m.index + 1);
          if (m[0].length === 0) {
            regex!.lastIndex++;
          }
        }
        return columns;
      },
    };
  }

  const needle = literal!;
  const haystackNeedle = caseInsensitive ? needle.toLowerCase() : needle;

  return {
    lineMatches(line: string) {
      const haystack = caseInsensitive ? line.toLowerCase() : line;
      return haystack.includes(haystackNeedle);
    },
    matchColumns(line: string) {
      const haystack = caseInsensitive ? line.toLowerCase() : line;
      const columns: number[] = [];
      let searchFrom = 0;
      while (searchFrom < haystack.length) {
        const columnIndex = haystack.indexOf(haystackNeedle, searchFrom);
        if (columnIndex === -1) {
          break;
        }
        columns.push(columnIndex + 1);
        searchFrom = columnIndex + Math.max(haystackNeedle.length, 1);
      }
      return columns;
    },
  };
}

function buildExcerpt(
  lines: readonly string[],
  lineIndex: number,
  contextLines: number,
): string {
  if (contextLines <= 0) {
    return lines[lineIndex] ?? "";
  }
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length - 1, lineIndex + contextLines);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * 在若干文件内容行中搜索 pattern，返回命中列表（不含条数/字节截断）。
 */
export function grepContents(
  rows: readonly VfsGrepContentRow[],
  pattern: string,
  options?: VfsGrepOptions,
): VfsGrepMatch[] {
  const matcher = createLineMatcher(pattern, options);
  const invert = options?.invert === true;
  const contextLines = Math.max(0, options?.contextLines ?? 0);
  const onePerFile = options?.oneMatchPerFile === true;
  const matches: VfsGrepMatch[] = [];

  for (const row of rows) {
    const lines = row.content.split("\n");
    let fileMatched = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (onePerFile && fileMatched) {
        break;
      }

      const line = lines[lineIndex]!;
      const hit = matcher.lineMatches(line);
      const shouldReport = invert ? !hit : hit;

      if (!shouldReport) {
        continue;
      }

      if (invert) {
        matches.push({
          path: row.path,
          line: lineIndex + 1,
          column: 1,
          excerpt: buildExcerpt(lines, lineIndex, contextLines),
        });
        fileMatched = true;
        if (onePerFile) {
          break;
        }
        continue;
      }

      const columns = matcher.matchColumns(line);
      for (const column of columns) {
        matches.push({
          path: row.path,
          line: lineIndex + 1,
          column,
          excerpt: buildExcerpt(lines, lineIndex, contextLines),
        });
        fileMatched = true;
        if (onePerFile) {
          break;
        }
      }
      if (onePerFile && fileMatched) {
        break;
      }
    }
  }

  return matches;
}
