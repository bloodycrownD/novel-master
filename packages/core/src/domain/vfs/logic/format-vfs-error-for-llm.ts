/**
 * 将 {@link VfsError} 格式化为 LLM 可读的分类文案（逻辑路径 + 诊断）。
 *
 * @module domain/vfs/logic/format-vfs-error-for-llm
 */

import {
  VfsError,
  type VfsErrorCode,
  type VfsReplaceNotFoundDetails,
} from "@/errors/vfs-errors.js";
import {
  MIN_LCS_LENGTH,
  truncateLcsSnippet,
} from "./longest-common-substring.js";
import type { VfsScope } from "./vfs-path-mapper.js";
import { stripKnownPhysicalPrefixes } from "./strip-known-physical-prefixes.js";

/**
 * entry_id 化后 vfsError.path 就是逻辑路径，直接用它就好。
 * scope 参数保留兼容签名，不再用于转换。
 */
function resolveLogicalPathForError(
  vfsError: VfsError,
  _scope?: VfsScope,
): string | undefined {
  if (vfsError.path == null) {
    return undefined;
  }
  return vfsError.path;
}

function extractInvalidPathReason(message: string): string {
  const match = message.match(/^Invalid path [^:]+: (.+)$/);
  return match?.[1] ?? stripKnownPhysicalPrefixes(message);
}

function formatReplaceNotFound(
  vfsError: VfsError,
  logicalPath: string,
): string {
  const details = vfsError.details as VfsReplaceNotFoundDetails | undefined;
  const pathLabel = logicalPath || vfsError.path || "unknown path";

  if (details == null) {
    return `[REPLACE_NOT_FOUND] Replace string not found in ${pathLabel}`;
  }

  if (details.lcsLength < MIN_LCS_LENGTH) {
    return `[REPLACE_NOT_FOUND] Replace string not found in ${pathLabel}.\nAlmost no matching text in file (longest common substring length=${details.lcsLength}). Re-read the file with read, then retry edit.`;
  }

  const snippet = truncateLcsSnippet(details.longestCommonSubstring);
  let out = `[REPLACE_NOT_FOUND] Replace string not found in ${pathLabel}.\nLongest matching substring in file (length=${details.lcsLength}, occurrences=${details.lcsOccurrences}): "${snippet}"\nUse this substring to locate the edit region and adjust oldString (e.g. whitespace/newlines).`;
  if (details.lcsOccurrences > 1) {
    out +=
      "\nSubstring appears " +
      String(details.lcsOccurrences) +
      " times; ensure oldString is unique or include more context.";
  }
  // 补上 codepoint 转储：肉眼看起来一样的中文引号 / HTML entity，码点一摆出来就露馅。
  // 这里同时展示 oldString 和文件对应区域的前 100 个码点，方便对比到底差在哪。
  if (details.oldStringCodepoints || details.fileHintCodepoints) {
    out += "\nCodepoint dump (first 100 chars, hex):";
    if (details.oldStringCodepoints) {
      out += `\n  oldString: ${details.oldStringCodepoints}`;
    }
    if (details.fileHintCodepoints) {
      out += `\n  fileHint:  ${details.fileHintCodepoints}`;
    }
    out +=
      "\nIf you see sequences like 26 6c 64 71 75 6f 3b, that is an unescaped HTML entity (e.g. &ldquo;); 201c is “, 201d is ”, 22 is an ASCII double quote.";
  }
  return out;
}

function formatByCode(
  code: VfsErrorCode,
  vfsError: VfsError,
  logicalPath: string,
): string {
  switch (code) {
    case "NOT_FOUND":
      return `[NOT_FOUND] Path not found: ${logicalPath}`;
    case "CONFLICT": {
      const e = vfsError.expectedVersion;
      const a = vfsError.actualVersion;
      if (e != null && a != null) {
        return `[CONFLICT] Version conflict for ${logicalPath}: expected ${e}, actual ${a}`;
      }
      return `[CONFLICT] ${stripKnownPhysicalPrefixes(vfsError.message)}`;
    }
    case "IS_DIRECTORY":
      return `[IS_DIRECTORY] Path is a directory: ${logicalPath}`;
    case "INVALID_PATH":
      return `[INVALID_PATH] Invalid path ${logicalPath}: ${extractInvalidPathReason(vfsError.message)}`;
    case "NOT_A_DIRECTORY":
      return `[NOT_A_DIRECTORY] Not a directory: ${logicalPath}`;
    case "PARENT_NOT_FOUND":
      return `[PARENT_NOT_FOUND] Parent not found: ${logicalPath}`;
    case "DIRECTORY_NOT_EMPTY":
      return `[DIRECTORY_NOT_EMPTY] Directory not empty: ${logicalPath}`;
    case "ALREADY_EXISTS":
      return `[ALREADY_EXISTS] Path already exists: ${logicalPath}`;
    case "REPLACE_NOT_FOUND":
      return formatReplaceNotFound(vfsError, logicalPath);
    default:
      return `[${code}] ${stripKnownPhysicalPrefixes(vfsError.message)}`;
  }
}

/** 将 VfsError 格式化为 LLM tool_result 正文（不含 `Error:` 前缀）。 */
export function formatVfsErrorForLlm(
  vfsError: VfsError,
  scope?: VfsScope,
): string {
  const logicalPath =
    resolveLogicalPathForError(vfsError, scope) ??
    stripKnownPhysicalPrefixes(vfsError.message);
  return formatByCode(vfsError.code, vfsError, logicalPath);
}
