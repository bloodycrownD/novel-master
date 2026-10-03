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
  _scope?: VfsScope
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
  logicalPath: string
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
  // 补上预览对照：肉眼看起来一样的中文引号 / HTML entity、看不见的换行制表，
  // JSON 转义一摆出来就露馅（“ vs " vs &ldquo;、\n/\t 显形）——且 LLM 能直接
  // 照抄预览修正 oldString（hex 码点无法反向消费，已退役）。
  if (details.oldStringPreview != null || details.fileHintPreview != null) {
    out += "\nPreview (first 100 chars, JSON-escaped):";
    if (details.oldStringPreview != null) {
      out += `\n  oldString: ${JSON.stringify(details.oldStringPreview)}`;
    }
    if (details.fileHintPreview != null) {
      out += `\n  fileHint:  ${JSON.stringify(details.fileHintPreview)}`;
    }
    out +=
      '\nCompare the two previews: sequences like &ldquo; are unescaped HTML entities (the file likely has “, U+201C, instead); “ and " are different quote characters; hidden whitespace shows up as \\n / \\t.';
  }
  return out;
}

function formatByCode(
  code: VfsErrorCode,
  vfsError: VfsError,
  logicalPath: string
): string {
  switch (code) {
    case "NOT_FOUND":
      return `[NOT_FOUND] Path not found: ${logicalPath}`;
    case "IS_DIRECTORY":
      return `[IS_DIRECTORY] Path is a directory: ${logicalPath}`;
    case "INVALID_PATH":
      return `[INVALID_PATH] Invalid path ${logicalPath}: ${extractInvalidPathReason(
        vfsError.message
      )}`;
    case "INVALID_NAME":
      // message 是中文 reason，LLM 面补上 code 前缀与名字定位
      return `[INVALID_NAME] Invalid entry name ${vfsError.path ?? logicalPath}: ${vfsError.message}`;
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
  scope?: VfsScope
): string {
  const logicalPath =
    resolveLogicalPathForError(vfsError, scope) ??
    stripKnownPhysicalPrefixes(vfsError.message);
  return formatByCode(vfsError.code, vfsError, logicalPath);
}
