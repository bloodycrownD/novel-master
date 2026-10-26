/**
 * replace 失败时构造带 LCS 诊断的 {@link AppError}。
 *
 * @module domain/vfs/logic/compute-replace-not-found-error
 */

import { AppError } from "@/errors/app-error.js";
import { countOccurrences, longestCommonSubstring } from "./longest-common-substring.js";

/** 预览时最多取的字符数，避免错误信息过长。 */
const MAX_PREVIEW_CHARS = 100;

/** buildReplaceNotFoundError 的失败载荷。 */
export type VfsReplaceNotFoundError = AppError<"VFS_REPLACE_NOT_FOUND">;

/** REPLACE_NOT_FOUND 的诊断字段；oldStringPreview / fileHintPreview 是原始文本预览。 */
export interface VfsReplaceNotFoundDetails {
  readonly oldStringLength: number;
  readonly longestCommonSubstring: string;
  readonly lcsLength: number;
  readonly lcsOccurrences: number;
  readonly oldStringPreview?: string;
  readonly fileHintPreview?: string;
}

/**
 * 取字符串前 N 个字符的**原始文本**预览（formatter 侧做 JSON 转义展示）。
 *
 * Array.from 按码点拆分后再拼回，代理对（emoji）不会被从中间切断。
 * 与退役的 hex 码点转储相比：中文引号 / HTML entity / 换行制表的差异
 * 同样显形，且 LLM 能直接照抄修正 oldString。
 */
function previewChars(input: string): string {
  return Array.from(input).slice(0, MAX_PREVIEW_CHARS).join("");
}

/** 在 oldString 未命中时构造 VFS_REPLACE_NOT_FOUND（含最长公共子串诊断）。 */
export function buildReplaceNotFoundError(path: string, fileContent: string, oldString: string): VfsReplaceNotFoundError {
  const lcs = longestCommonSubstring(oldString, fileContent);
  const occurrences = lcs.length > 0 ? countOccurrences(fileContent, lcs.substring) : 0;
  // 拿最长公共子串在文件里第一次出现的位置当锚点，从锚点起点截 100 字符；
  // 没有公共子串时退回文件开头 100 字符，让 oldString 与文件片段并列可比对。
  const lcsIndex = lcs.substring.length > 0 ? fileContent.indexOf(lcs.substring) : -1;
  const details: VfsReplaceNotFoundDetails = {
    oldStringLength: oldString.length,
    longestCommonSubstring: lcs.substring,
    lcsLength: lcs.length,
    lcsOccurrences: occurrences,
    oldStringPreview: previewChars(oldString),
    fileHintPreview: previewChars(lcsIndex >= 0 ? fileContent.slice(lcsIndex) : fileContent),
  };
  return new AppError("VFS_REPLACE_NOT_FOUND", `Replace string not found in ${path}`, { path, details });
}
