/**
 * replace 失败时构造带 LCS 诊断的 {@link VfsError}。
 *
 * @module domain/vfs/logic/compute-replace-not-found-error
 */

import {
  vfsReplaceNotFound,
  type VfsReplaceNotFoundDetails,
} from "@/errors/vfs-errors.js";
import {
  countOccurrences,
  longestCommonSubstring,
} from "./longest-common-substring.js";

/** 预览时最多取的字符数，避免错误信息过长。 */
const MAX_PREVIEW_CHARS = 100;

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

/**
 * 在 currentContent 里定位 oldString 「可能对应」的区域，取前 100 字符。
 *
 * 因为 oldString 整体没命中，所以拿最长公共子串在文件里第一次出现的位置当锚点，
 * 从锚点起点开始截 100 个字符；如果连公共子串都没有，就退回文件开头 100 字符。
 * 这样诊断信息里 oldString 和文件片段的预览摆在一起，对比就直观了。
 */
function pickFileHintRegion(fileContent: string, lcsSubstring: string): string {
  if (lcsSubstring.length > 0) {
    const index = fileContent.indexOf(lcsSubstring);
    if (index >= 0) {
      return previewChars(fileContent.slice(index));
    }
  }
  return previewChars(fileContent);
}

/** 在 oldString 未命中时构造 REPLACE_NOT_FOUND（含最长公共子串诊断）。 */
export function buildReplaceNotFoundError(
  path: string,
  fileContent: string,
  oldString: string
) {
  const lcs = longestCommonSubstring(oldString, fileContent);
  const occurrences =
    lcs.length > 0 ? countOccurrences(fileContent, lcs.substring) : 0;
  const details: VfsReplaceNotFoundDetails = {
    oldStringLength: oldString.length,
    longestCommonSubstring: lcs.substring,
    lcsLength: lcs.length,
    lcsOccurrences: occurrences,
    oldStringPreview: previewChars(oldString),
    fileHintPreview: pickFileHintRegion(fileContent, lcs.substring),
  };
  return vfsReplaceNotFound(path, details);
}
