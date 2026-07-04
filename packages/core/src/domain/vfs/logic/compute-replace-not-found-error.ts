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

/** 在 oldString 未命中时构造 REPLACE_NOT_FOUND（含最长公共子串诊断）。 */
export function buildReplaceNotFoundError(
  path: string,
  fileContent: string,
  oldString: string,
) {
  const lcs = longestCommonSubstring(oldString, fileContent);
  const occurrences =
    lcs.length > 0 ? countOccurrences(fileContent, lcs.substring) : 0;
  const details: VfsReplaceNotFoundDetails = {
    oldStringLength: oldString.length,
    longestCommonSubstring: lcs.substring,
    lcsLength: lcs.length,
    lcsOccurrences: occurrences,
  };
  return vfsReplaceNotFound(path, details);
}
