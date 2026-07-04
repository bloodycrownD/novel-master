/**
 * 最长公共子串与出现次数（edit 失败诊断用）。
 *
 * @module domain/vfs/logic/longest-common-substring
 */

/** 低于此长度的公共子串视为「几乎无匹配」。 */
export const MIN_LCS_LENGTH = 4;

/** LLM / 用户可见 snippet 展示上限。 */
export const MAX_LCS_SNIPPET_CHARS = 200;

export type LongestCommonSubstringResult = {
  readonly substring: string;
  readonly length: number;
};

/** 统计 needle 在 haystack 中的非重叠出现次数（重叠时仍计每次 indexOf 命中）。 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let start = 0;
  while (start <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) {
      break;
    }
    count += 1;
    start = index + 1;
  }
  return count;
}

/**
 * 求 a 与 b 的最长公共子串；并列最长时取在 b 中首次出现位置最靠前的子串。
 */
export function longestCommonSubstring(
  a: string,
  b: string,
): LongestCommonSubstringResult {
  if (a.length === 0 || b.length === 0) {
    return { substring: "", length: 0 };
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  let maxLen = 0;
  const endsInB: number[] = [];

  const dp: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
        const len = dp[i]![j]!;
        if (len > maxLen) {
          maxLen = len;
          endsInB.length = 0;
          endsInB.push(j);
        } else if (len === maxLen && len > 0) {
          endsInB.push(j);
        }
      }
    }
  }

  if (maxLen === 0) {
    return { substring: "", length: 0 };
  }

  const endInB = Math.min(...endsInB);
  const startInB = endInB - maxLen;
  return {
    substring: b.slice(startInB, endInB),
    length: maxLen,
  };
}

/** 截断展示用 snippet。 */
export function truncateLcsSnippet(snippet: string): string {
  if (snippet.length <= MAX_LCS_SNIPPET_CHARS) {
    return snippet;
  }
  return `${snippet.slice(0, MAX_LCS_SNIPPET_CHARS)}…`;
}
