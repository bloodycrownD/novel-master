/**
 * 最长公共子串与出现次数（edit 失败诊断用）。
 *
 * @module domain/vfs/logic/longest-common-substring
 */

/** 低于此长度的公共子串视为「几乎无匹配」。 */
export const MIN_LCS_LENGTH = 4;

/** LLM / 用户可见 snippet 展示上限。 */
export const MAX_LCS_SNIPPET_CHARS = 200;

/** DP 单元格上界；超过即走降级路径（≈ 2e6 格 × 4B ≈ 8MB）。 */
const LCS_DP_MAX_CELLS = 2_000_000;

/** 降级时两侧各自的长度下限；低于此值直接放弃 LCS。 */
const LCS_DEGRADED_MIN_CHARS = 512;

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
 *
 * @remarks DP 只依赖「上一行的左上角」，故用滚动两行 `Int32Array` 而非全表
 * `number[][]`：格子从「8B 指针 + 可能装箱」降到 4B，分配次数从 `rows+1` 降到 2。
 * `endsInB` 记的是 **b 的下标**，沿行滚动足够（沿列滚动会漏 `prev[j-1]`）。
 * 两侧字符数过大时按比例裁剪降级——诊断路径（edit 未命中时对整篇正文跑 LCS）
 * 不能因为一次失败诊断把进程打爆；降级结果被上游三处 `length === 0` 分支消化，
 * 错误码与调用流程零变化。
 */
export function longestCommonSubstring(
  a: string,
  b: string
): LongestCommonSubstringResult {
  if (a.length === 0 || b.length === 0) {
    return { substring: "", length: 0 };
  }

  // 超阈值降级：按**同一比例**裁两侧（只砍一侧会让另一侧独占全部预算）。
  // scale = sqrt(上限 / 实际) ⇒ 裁剪后 nextA × nextB ≤ 上限恒成立，不需二次判阈值。
  const totalCells = a.length * b.length;
  if (totalCells > LCS_DP_MAX_CELLS) {
    const scale = Math.sqrt(LCS_DP_MAX_CELLS / totalCells);
    const nextA = Math.floor(a.length * scale);
    const nextB = Math.floor(b.length * scale);
    if (nextA < LCS_DEGRADED_MIN_CHARS || nextB < LCS_DEGRADED_MIN_CHARS) {
      // 砍到没意义，直接放弃 LCS 诊断。
      return { substring: "", length: 0 };
    }
    a = a.slice(0, nextA);
    b = b.slice(0, nextB);
  }

  const cols = b.length + 1;
  let maxLen = 0;
  const endsInB: number[] = [];

  let prev = new Int32Array(cols);
  let cur = new Int32Array(cols);

  for (let i = 1; i < a.length + 1; i++) {
    cur.fill(0);
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        const len = prev[j - 1]! + 1;
        cur[j] = len;
        if (len > maxLen) {
          maxLen = len;
          endsInB.length = 0;
          endsInB.push(j);
        } else if (len === maxLen && len > 0) {
          endsInB.push(j);
        }
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }

  if (maxLen === 0) {
    return { substring: "", length: 0 };
  }

  // 循环取最小值：`Math.min(...endsInB)` 在并列最长子串极多时会撞 V8 的
  // 参数展开上限（≈2×10⁵）抛 RangeError——endsInB 最坏可达 O(min(a,b)) 条。
  let endInB = Number.POSITIVE_INFINITY;
  for (const value of endsInB) {
    if (value < endInB) {
      endInB = value;
    }
  }
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
