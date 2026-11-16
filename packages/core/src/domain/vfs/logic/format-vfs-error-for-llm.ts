/**
 * 将 VFS 域 AppError 格式化为 LLM 可读的分类文案（逻辑路径 + 诊断）。
 *
 * @module domain/vfs/logic/format-vfs-error-for-llm
 */

import type { AppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import type { VfsReplaceNotFoundDetails } from "@/errors/guards.js";
import { MIN_LCS_LENGTH, truncateLcsSnippet } from "./longest-common-substring.js";
import type { VfsScope } from "./vfs-path-mapper.js";
import { stripKnownPhysicalPrefixes } from "./strip-known-physical-prefixes.js";

// nm-style: keep-local — REPLACE_NOT_FOUND 分支独占 LCS 诊断与预览渲染；
// 内联会让主 switch 混入 30 行诊断组装，且两处提前返回都依赖 details 收窄。
function formatReplaceNotFound(details: VfsReplaceNotFoundDetails | undefined, pathHint: string | undefined, logicalPath: string): string {
  const pathLabel = logicalPath || pathHint || "unknown path";

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

/** 其余 VFS key 的 LLM 标签旧短码字面量（key 剥前缀的旧输出零变化，判别不再依赖命名约定）。 */
const VFS_KEY_TO_LABEL: Partial<Record<ErrorKey, string>> = {
  VFS_INVALID_PATTERN: "INVALID_PATTERN",
  VFS_ZIP_INVALID_ARCHIVE: "ZIP_INVALID_ARCHIVE",
  VFS_ZIP_INVALID_PATH: "ZIP_INVALID_PATH",
  VFS_ZIP_INVALID_UTF8: "ZIP_INVALID_UTF8",
  VFS_ZIP_DUPLICATE_PATH: "ZIP_DUPLICATE_PATH",
  VFS_ZIP_PAYLOAD_TOO_LARGE: "ZIP_PAYLOAD_TOO_LARGE",
  VFS_ZIP_NOT_CONFIRMED: "ZIP_NOT_CONFIRMED",
  VFS_ZIP_EXTERNAL_NOT_SUPPORTED: "ZIP_EXTERNAL_NOT_SUPPORTED",
  VFS_ZIP_IMPORT_FAILED: "ZIP_IMPORT_FAILED",
  VFS_CONTENT_CORRUPT: "CONTENT_CORRUPT",
  VFS_CONTENT_UNSUPPORTED_FORMAT: "CONTENT_UNSUPPORTED_FORMAT",
  VFS_CONTENT_BLOB_MISSING: "CONTENT_BLOB_MISSING",
  VFS_RESTORE_FAILED: "RESTORE_FAILED",
  VFS_OPERATION_UNSUPPORTED: "OPERATION_UNSUPPORTED",
  VFS_SINGLE_FILE_TOO_LARGE: "SINGLE_FILE_TOO_LARGE",
  VFS_SINGLE_FILE_READ_FAILED: "SINGLE_FILE_READ_FAILED",
  VFS_SINGLE_FILE_NOT_FOUND: "SINGLE_FILE_NOT_FOUND",
  VFS_SINGLE_FILE_EXPORT_TARGET_INVALID: "SINGLE_FILE_EXPORT_TARGET_INVALID",
  VFS_CHARACTER_CARD_UNRECOGNIZED: "CHARACTER_CARD_UNRECOGNIZED",
  VFS_CHARACTER_CARD_UNSUPPORTED_SPEC: "CHARACTER_CARD_UNSUPPORTED_SPEC",
  VFS_CHARACTER_CARD_INVALID_PATH: "CHARACTER_CARD_INVALID_PATH",
  VFS_CHARACTER_CARD_NOT_CONFIRMED: "CHARACTER_CARD_NOT_CONFIRMED",
  VFS_CHARACTER_CARD_IMPORT_FAILED: "CHARACTER_CARD_IMPORT_FAILED",
  VFS_CHARACTER_CARD_TOO_LARGE: "CHARACTER_CARD_TOO_LARGE",
};

/** 将 VFS 域 AppError 格式化为 LLM tool_result 正文（不含 `Error:` 前缀）；LLM 面沿用旧短码标签（`[NOT_FOUND]` 等），判别走 `error.key` 的 switch（穷尽、类型安全），短码只出现在输出模板与标签表的字面量里；非 VFS key 落兜底 message 全文。 */
export function formatVfsErrorForLlm(error: AppError, _scope?: VfsScope): string {
  // LCS 诊断字段平铺在 AppError details 顶层（VfsError 类退役后的形状）。
  const details: unknown = error.details;
  const path = typeof details === "object" && details != null && typeof (details as {path?: unknown}).path === "string" ? (details as {path?: unknown}).path as string : undefined;
  const logicalPath = path ?? stripKnownPhysicalPrefixes(error.message);
  switch (error.key) {
    case "VFS_NOT_FOUND":
      return `[NOT_FOUND] Path not found: ${logicalPath}`;
    case "VFS_IS_DIRECTORY":
      return `[IS_DIRECTORY] Path is a directory: ${logicalPath}`;
    case "VFS_INVALID_PATH": {
      const match = error.message.match(/^Invalid path [^:]+: (.+)$/);
      return `[INVALID_PATH] Invalid path ${logicalPath}: ${match?.[1] ?? stripKnownPhysicalPrefixes(error.message)}`;
    }
    case "VFS_INVALID_NAME":
      // message 是中文 reason，LLM 面补上 code 前缀与名字定位
      return `[INVALID_NAME] Invalid entry name ${path ?? logicalPath}: ${error.message}`;
    case "VFS_NOT_A_DIRECTORY":
      return `[NOT_A_DIRECTORY] Not a directory: ${logicalPath}`;
    case "VFS_PARENT_NOT_FOUND":
      return `[PARENT_NOT_FOUND] Parent not found: ${logicalPath}`;
    case "VFS_DIRECTORY_NOT_EMPTY":
      return `[DIRECTORY_NOT_EMPTY] Directory not empty: ${logicalPath}`;
    case "VFS_ALREADY_EXISTS":
      return `[ALREADY_EXISTS] Path already exists: ${logicalPath}`;
    case "VFS_REPLACE_NOT_FOUND":
      return formatReplaceNotFound(details as VfsReplaceNotFoundDetails | undefined, path, logicalPath);
    default: {
      const label = VFS_KEY_TO_LABEL[error.key];
      return label != null ? `[${label}] ${stripKnownPhysicalPrefixes(error.message)}` : stripKnownPhysicalPrefixes(error.message);
    }
  }
}
