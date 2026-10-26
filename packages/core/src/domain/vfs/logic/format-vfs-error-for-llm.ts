/**
 * 将 VfsError / AppError 格式化为 LLM 可读的分类文案（逻辑路径 + 诊断）。
 *
 * @module domain/vfs/logic/format-vfs-error-for-llm
 */

import { isAppError, type AppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import type { VfsError, VfsErrorCode, VfsReplaceNotFoundDetails } from "@/errors/vfs-errors.js";
import { MIN_LCS_LENGTH, truncateLcsSnippet } from "./longest-common-substring.js";
import type { VfsScope } from "./vfs-path-mapper.js";
import { stripKnownPhysicalPrefixes } from "./strip-known-physical-prefixes.js";

type VfsErrorLike = {
  readonly code: VfsErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly details?: unknown;
};

const APP_ERROR_TO_VFS_CODE: Partial<Record<ErrorKey, VfsErrorCode>> = {
  VFS_NOT_FOUND: "NOT_FOUND",
  VFS_REPLACE_NOT_FOUND: "REPLACE_NOT_FOUND",
  VFS_DIRECTORY_NOT_EMPTY: "DIRECTORY_NOT_EMPTY",
  VFS_INVALID_PATH: "INVALID_PATH",
  VFS_INVALID_NAME: "INVALID_NAME",
  VFS_IS_DIRECTORY: "IS_DIRECTORY",
  VFS_ALREADY_EXISTS: "ALREADY_EXISTS",
  VFS_NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  VFS_PARENT_NOT_FOUND: "PARENT_NOT_FOUND",
};

// nm-style: keep-local — REPLACE_NOT_FOUND 分支独占 LCS 诊断与预览渲染；
// 内联会让主 switch 混入 30 行诊断组装，且两处提前返回都依赖 details 收窄。
function formatReplaceNotFound(error: VfsErrorLike, logicalPath: string): string {
  const details = error.details as VfsReplaceNotFoundDetails | undefined;
  const pathLabel = logicalPath || error.path || "unknown path";

  if (details == null) {
    return `[REPLACE_NOT_FOUND] Replace string not found in ${pathLabel}`;
  }

  if (details.lcsLength < MIN_LCS_LENGTH) {
    return `[REPLACE_NOT_FOUND] Replace string not found in ${pathLabel}.\nAlmost no matching text in file (longest common substring length=${details.lcsLength}). Re-read the file with read, then retry edit.`;
  }

  const snippet = truncateLcsSnippet(details.longestCommonSubstring);
  let out = `[REPLACE_NOT_FOUND] Replace string not found in ${pathLabel}.\nLongest matching substring in file (length=${details.lcsLength}, occurrences=${details.lcsOccurrences}): "${snippet}"\nUse this substring to locate the edit region and adjust oldString (e.g. whitespace/newlines).`;
  if (details.lcsOccurrences > 1) {
    out += "\nSubstring appears " + String(details.lcsOccurrences) + " times; ensure oldString is unique or include more context.";
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
    out += '\nCompare the two previews: sequences like &ldquo; are unescaped HTML entities (the file likely has “, U+201C, instead); “ and " are different quote characters; hidden whitespace shows up as \\n / \\t.';
  }
  return out;
}

/** 将 VfsError / AppError 格式化为 LLM tool_result 正文（不含 `Error:` 前缀）。 */
export function formatVfsErrorForLlm(error: VfsError | AppError, _scope?: VfsScope): string {
  let normalized: VfsErrorLike | null;
  if (isAppError(error)) {
    const code = APP_ERROR_TO_VFS_CODE[error.key];
    normalized = code == null ? null : { code, message: error.message, path: typeof error.details?.path === "string" ? error.details.path : undefined, details: error.details?.details ?? error.details };
  } else {
    normalized = error;
  }
  if (normalized == null) {
    return stripKnownPhysicalPrefixes(error.message);
  }
  const logicalPath = normalized.path ?? stripKnownPhysicalPrefixes(normalized.message);
  switch (normalized.code) {
    case "NOT_FOUND":
      return `[NOT_FOUND] Path not found: ${logicalPath}`;
    case "IS_DIRECTORY":
      return `[IS_DIRECTORY] Path is a directory: ${logicalPath}`;
    case "INVALID_PATH": {
      const match = normalized.message.match(/^Invalid path [^:]+: (.+)$/);
      return `[INVALID_PATH] Invalid path ${logicalPath}: ${match?.[1] ?? stripKnownPhysicalPrefixes(normalized.message)}`;
    }
    case "INVALID_NAME":
      // message 是中文 reason，LLM 面补上 code 前缀与名字定位
      return `[INVALID_NAME] Invalid entry name ${normalized.path ?? logicalPath}: ${normalized.message}`;
    case "NOT_A_DIRECTORY":
      return `[NOT_A_DIRECTORY] Not a directory: ${logicalPath}`;
    case "PARENT_NOT_FOUND":
      return `[PARENT_NOT_FOUND] Parent not found: ${logicalPath}`;
    case "DIRECTORY_NOT_EMPTY":
      return `[DIRECTORY_NOT_EMPTY] Directory not empty: ${logicalPath}`;
    case "ALREADY_EXISTS":
      return `[ALREADY_EXISTS] Path already exists: ${logicalPath}`;
    case "REPLACE_NOT_FOUND":
      return formatReplaceNotFound(normalized, logicalPath);
    default:
      return `[${normalized.code}] ${stripKnownPhysicalPrefixes(normalized.message)}`;
  }
}
