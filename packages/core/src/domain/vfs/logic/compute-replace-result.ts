/**
 * 计算 vfs `replace` 的结果（纯函数）。
 *
 * 把「读到的当前内容」按 oldString 命中情况拼成 nextContent，
 * 未命中时抛出带 LCS 诊断的 REPLACE_NOT_FOUND。
 *
 * @module domain/vfs/logic/compute-replace-result
 */

import { buildReplaceNotFoundError } from "./compute-replace-not-found-error.js";
import { normalizeForMatch } from "./normalize-for-match.js";

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
  options?: ComputeReplaceResultOptions
): ComputeReplaceResult {
  // 归一化只用于 indexOf 定位；切片和拼接全部走原文 currentContent，
  // 保证未替换段的引号形态原样保留（落盘不被归一化改写）。
  // v1 归一化是严格 1:1 映射（引号族 + 全角空格），归一化前后 UTF-16 码元
  // 数严格相等，归一化坐标系的 index 可以直接当作原文 index 用。
  const normalizedContent = normalizeForMatch(currentContent);
  const normalizedOld = normalizeForMatch(oldString);

  if (options?.replaceAll) {
    // 不能用 split/join：split 返回的片段是归一化后的内容（弯引号已变直引号），
    // join 后未替换段的原文引号会被悄悄改写，违反「归一化只用于定位」的硬约束。
    // 改成「归一化坐标系循环 indexOf 收集命中 positions + 原文逐段切片拼接」。
    const positions: Array<{ start: number; end: number }> = [];
    let searchFrom = 0;
    while (true) {
      const idx = normalizedContent.indexOf(normalizedOld, searchFrom);
      if (idx === -1) break;
      positions.push({ start: idx, end: idx + oldString.length });
      searchFrom = idx + normalizedOld.length;
    }
    if (positions.length === 0) {
      // 一处都没命中就直接报错，避免出现「整段原样返回」的假成功。
      throw buildReplaceNotFoundError(path, currentContent, oldString);
    }
    let result = "";
    let cursor = 0;
    for (const pos of positions) {
      result += currentContent.slice(cursor, pos.start); // 原文片段，引号原样
      result += newString; // 模型给的替换串（不归一化）
      cursor = pos.end;
    }
    result += currentContent.slice(cursor);
    return { nextContent: result, replacements: positions.length };
  }

  const index = normalizedContent.indexOf(normalizedOld);
  if (index === -1) {
    throw buildReplaceNotFoundError(path, currentContent, oldString);
  }
  // 切片用原文 + 原始 oldString.length，保证落盘内容保持原文引号不被改写。
  return {
    nextContent:
      currentContent.slice(0, index) +
      newString +
      currentContent.slice(index + oldString.length),
    replacements: 1,
  };
}
