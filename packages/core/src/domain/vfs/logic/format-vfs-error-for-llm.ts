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
import {
  type VfsScope,
  toLogicalPath,
} from "./vfs-path-mapper.js";
import { stripKnownPhysicalPrefixes } from "./strip-known-physical-prefixes.js";

function resolveLogicalPathForError(
  vfsError: VfsError,
  scope?: VfsScope,
): string | undefined {
  if (vfsError.path == null) {
    return undefined;
  }
  if (scope == null) {
    return stripKnownPhysicalPrefixes(vfsError.path);
  }
  try {
    return toLogicalPath(scope, vfsError.path);
  } catch {
    return stripKnownPhysicalPrefixes(vfsError.path);
  }
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
