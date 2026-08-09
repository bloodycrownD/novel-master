/**
 * 计算 vfs `replace` 的结果（纯函数）。
 *
 * 把「读到的当前内容」按 oldString 命中情况拼成 nextContent，
 * 未命中时抛出带 LCS 诊断的 REPLACE_NOT_FOUND。
 *
 * @module domain/vfs/logic/compute-replace-result
 */

import { buildReplaceNotFoundError } from "./compute-replace-not-found-error.js";

/** replace 的可选参数。 */
export interface ComputeReplaceResultOptions {
  /** 是否替换全部命中，默认只替换第一处。 */
  replaceAll?: boolean;
}

/** computeReplaceResult 的返回值。 */
export interface ComputeReplaceResult {
  /** 拼接后的新内容。 */
  nextContent: string;
  /** 实际发生的替换次数。 */
  replacements: number;
}

/**
 * 在 currentContent 上根据 oldString/newString 计算替换后的内容。
 *
 * 因为这一步不碰 IO，所以 service 层只要 read 出内容、调它、再把
 * nextContent 写回去就行了。oldString 没命中的话会抛 REPLACE_NOT_FOUND，
 * 诊断信息（最长公共子串）由 buildReplaceNotFoundError 负责；path 只在
 * 构造错误详情时用，所以一并传进来，方便定位是哪个文件没命中。
 */
export function computeReplaceResult(
  path: string,
  currentContent: string,
  oldString: string,
  newString: string,
  options?: ComputeReplaceResultOptions,
): ComputeReplaceResult {
  if (options?.replaceAll) {
    // 一处都没命中就直接报错，避免 split 出现「整段原样返回」的假成功。
    if (!currentContent.includes(oldString)) {
      throw buildReplaceNotFoundError(path, currentContent, oldString);
    }
    const parts = currentContent.split(oldString);
    return {
      nextContent: parts.join(newString),
      replacements: parts.length - 1,
    };
  }

  const index = currentContent.indexOf(oldString);
  if (index === -1) {
    throw buildReplaceNotFoundError(path, currentContent, oldString);
  }
  return {
    nextContent:
      currentContent.slice(0, index) +
      newString +
      currentContent.slice(index + oldString.length),
    replacements: 1,
  };
}
