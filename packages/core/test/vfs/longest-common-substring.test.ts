import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countOccurrences,
  longestCommonSubstring,
  MAX_LCS_SNIPPET_CHARS,
  MIN_LCS_LENGTH,
  truncateLcsSnippet,
} from "../../src/domain/vfs/logic/longest-common-substring.js";

describe("longestCommonSubstring", () => {
  it("T-LCS-01: finds non-empty substring for whitespace difference", () => {
    const a = "function hello() {    return 1; }";
    const b = "function hello() { return 1; }";
    const result = longestCommonSubstring(a, b);
    assert.ok(result.length >= MIN_LCS_LENGTH);
    assert.ok(b.includes(result.substring));
  });

  it("T-LCS-02: unrelated strings yield short substring", () => {
    const result = longestCommonSubstring("abc", "xyz");
    assert.ok(result.length < MIN_LCS_LENGTH);
  });

  it("T-LCS-03: countOccurrences counts multiple hits", () => {
    assert.equal(countOccurrences("aa aa aa", "aa"), 3);
  });

  it("T-LCS-04: truncateLcsSnippet caps length", () => {
    const long = "x".repeat(MAX_LCS_SNIPPET_CHARS + 10);
    const truncated = truncateLcsSnippet(long);
    assert.ok(truncated.endsWith("…"));
    assert.ok(truncated.length <= MAX_LCS_SNIPPET_CHARS + 1);
  });
});

describe("longestCommonSubstring 中文引号场景", () => {
  it("T-LCS-CN: 弯引号 vs 直引号能找到公共子串（诊断可读性）", () => {
    // edit 失败时 LCS 诊断要把「除了引号其他都对得上」这件事摆出来，
    // 所以这里验证弯引号与直引号之间至少能命中一段不含引号的公共子串。
    const fileContent = `他说“你好”`;
    const oldString = `他说“你好”`;
    const result = longestCommonSubstring(oldString, fileContent);
    assert.ok(result.length >= MIN_LCS_LENGTH);
    assert.ok(fileContent.includes(result.substring));
    // 主体「你好」应该出现在公共子串里（撇开引号差异）
    assert.ok(result.substring.includes("你好"));
  });
});

/**
 * 参考实现（oracle）：改动前的**全表 DP** 原样抄一份。
 *
 * ⚠️ 这是本文件唯一允许的重复代码——它存在的唯一目的是把「滚动两行 Int32Array
 * 重写没改语义」这件事钉成一条逐字可比的断言。随 C2-11 一起删。
 */
function referenceLongestCommonSubstring(
  a: string,
  b: string
): { substring: string; length: number } {
  if (a.length === 0 || b.length === 0) {
    return { substring: "", length: 0 };
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  let maxLen = 0;
  const endsInB: number[] = [];
  const dp: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0)
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
        const len = dp[i]![j]!!;
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
  return { substring: b.slice(endInB - maxLen, endInB), length: maxLen };
}

describe("C2-11 大输入降级与结果等价", () => {
  it("T-LCS-DEGRADE-1: 两侧各 5 万字符（2.5 亿格）走降级路径，不崩且结果仍正确", () => {
    // 旧实现按全表 DP 分配 (a+1)×(b+1) 个 JS number，约 689MB ⇒ 会 OOM /
    // RangeError；新实现按比例裁剪到 2e6 格以内。
    const a = "ab".repeat(25_000);
    const b = "ab".repeat(25_000);
    if (global.gc != null) {
      global.gc();
    }
    const before = process.memoryUsage().heapUsed;
    const result = longestCommonSubstring(a, b);
    const deltaMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);

    assert.ok(result.length > 0, "降级后仍应给出可用的诊断片段");
    assert.ok(b.includes(result.substring));
    // 两侧都被按同一比例裁剪 ⇒ 裁剪后的 b 长度即结果长度上界。
    assert.equal(result.length, result.substring.length);
    assert.ok(deltaMb < 200, `堆增量 ${deltaMb.toFixed(1)}MB 过大：降级没生效`);
  });

  it("T-LCS-DEGRADE-2: 裁到没意义时直接放弃 LCS（length=0，错误码与流程不变）", () => {
    // 一侧极长、一侧极短（3e6 格 > 2e6 上限）⇒ 按比例裁剪后短侧低于
    // LCS_DEGRADED_MIN_CHARS ⇒ 放弃诊断。降级若失效，本例会算出 LCS = "x"。
    const result = longestCommonSubstring("x".repeat(1_000_000), "xyz");
    assert.equal(result.length, 0);
    assert.equal(result.substring, "");
  });

  it("T-LCS-SPREAD: a=b 的超长同字符串不再撞 Math.min(...arr) 的展开上限", () => {
    // endsInB 在同字符串上会堆到 O(min(a,b)) 条；旧实现的 spread 会抛
    // RangeError: Maximum call stack size exceeded。
    const same = "x".repeat(300_000);
    const result = longestCommonSubstring(same, same);
    assert.ok(result.length > 0, "不得抛 RangeError");
    assert.equal(result.substring, "x".repeat(result.length));
  });

  it("T-LCS-EQUIV: 20 组样本与全表 DP oracle 逐字相等（含并列最长）", () => {
    const samples: Array<[string, string]> = [
      ["abc", "abc"],
      ["abc", "xyz"],
      ["", "abc"],
      ["abc", ""],
      ["aab", "baa"], // 并列最长
      ["aaaa", "baaa"], // 并列最长 + 不同前缀
      ["function hello() {    return 1; }", "function hello() { return 1; }"],
      [`他说“你好”`, `他说"你好"`],
      ["行1\n行2\n行3", "行2\n行3\n行4"],
      ["aaaaab", "baaaaa"],
      ["abababab", "babababa"],
      ["重复重复重复", "重复重复别别别"],
      ["\n\t缩进不同", "  缩进不同\n"],
      ["a".repeat(1200), "a".repeat(1200)], // 同字符长串（并列最长）
      ["z" + "a".repeat(800) + "z", "a".repeat(1500) + "q"],
      ["中文中文中文", "中文中文英文"],
      ["prefix-unique-suffix", "other-unique-prefix"],
      ["abcabcabc", "xyzabcabc"],
      ["0123456789".repeat(120), "6789012345".repeat(120)],
      ["tail-only", "head-only"],
    ];
    for (const [a, b] of samples) {
      const actual = longestCommonSubstring(a, b);
      const expected = referenceLongestCommonSubstring(a, b);
      assert.equal(
        actual.length,
        expected.length,
        `length 不一致：a=${JSON.stringify(a.slice(0, 20))} b=${JSON.stringify(b.slice(0, 20))}`
      );
      assert.equal(
        actual.substring,
        expected.substring,
        `substring 不一致：a=${JSON.stringify(a.slice(0, 20))} b=${JSON.stringify(b.slice(0, 20))}`
      );
    }
  });
});
