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

/** codepoint 转储时最多取的字符数，避免错误信息过长。 */
const MAX_CODEPOINT_DUMP_CHARS = 100;

/**
 * 把字符串前 N 个字符按 codepoint 转成 hex，空格分隔。
 *
 * 比如 `"你好"` → `4f60 597d`。空串返回空字符串。这样下次 edit 失败时，
 * 能直接从错误信息里看出是 entity 没解（`26 6c 64 71 75 6f 3b` 是 `&ldquo;`）
 * 还是引号形态不一致（`201c` 与 `22` 的差别）。
 */
function dumpCodepoints(input: string): string {
  // Array.from 会按码点拆分，代理对会合并成单个元素，避免把一个 emoji 切成两半。
  const chars = Array.from(input).slice(0, MAX_CODEPOINT_DUMP_CHARS);
  return chars.map((ch) => ch.codePointAt(0)!.toString(16)).join(" ");
}

/**
 * 在 currentContent 里定位 oldString 「可能对应」的区域，取前 100 字符。
 *
 * 因为 oldString 整体没命中，所以拿最长公共子串在文件里第一次出现的位置当锚点，
 * 从锚点起点开始截 100 个字符；如果连公共子串都没有，就退回文件开头 100 字符。
 * 这样诊断信息里 oldString 和文件片段的码点摆在一起，对比就直观了。
 */
function pickFileHintRegion(fileContent: string, lcsSubstring: string): string {
  if (lcsSubstring.length > 0) {
    const index = fileContent.indexOf(lcsSubstring);
    if (index >= 0) {
      return fileContent.slice(index, index + MAX_CODEPOINT_DUMP_CHARS);
    }
  }
  return fileContent.slice(0, MAX_CODEPOINT_DUMP_CHARS);
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
  const fileHint = pickFileHintRegion(fileContent, lcs.substring);
  const details: VfsReplaceNotFoundDetails = {
    oldStringLength: oldString.length,
    longestCommonSubstring: lcs.substring,
    lcsLength: lcs.length,
    lcsOccurrences: occurrences,
    oldStringCodepoints: dumpCodepoints(oldString),
    fileHintCodepoints: dumpCodepoints(fileHint),
  };
  return vfsReplaceNotFound(path, details);
}
