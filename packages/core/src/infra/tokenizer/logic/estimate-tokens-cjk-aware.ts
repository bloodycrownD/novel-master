/**
 * CJK 感知的廉价 token 估算（无分词器、纯字符统计）。
 *
 * 背景：heuristic 口径 `ceil(字符/3.35)` 是英文系数，对中文正文系统性低估
 * 八成（cl100k 实测约 1.64 token/字符）——压缩阈值拿它判定会「快满了还在
 * 继续写」。本函数按 CJK 字符 ×{@link CJK_TOKENS_PER_CHAR} + 其余字符
 * ÷3.35 折算，作为各种廉价估算路径的**保守下限**（与真实分词器的偏差
 * 有界：中文≈持平略高、英文高约 20%——高估方向对阈值判定安全）。
 *
 * 消费方：读口 `preferEstimate` 分支（压缩评估，2026-09-29）、api 基线的
 * 增量估算下限（estimateAnchoredDelta）。先例：mock 上报口径的
 * 「一字≈一词元 + 其余 ÷3.35」同族思路（RULE 真机验收条）。
 *
 * @module infra/tokenizer/logic/estimate-tokens-cjk-aware
 */

/** CJK 字符的 token 折算系数：cl100k 对中文实测 ≈1.64 token/字符。 */
export const CJK_TOKENS_PER_CHAR = 1.64;

/** 非 CJK 字符沿用既有英文口径的倒数（1 / 3.35）。 */
const NON_CJK_CHARS_PER_TOKEN = 3.35;

/** CJK 统用表意文字 + 假名 + 谚文（不含全角标点——按非 CJK 宽松处理）。 */
const CJK_CHAR_PATTERN = /[\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g;

function countCjkChars(text: string): number {
  const matches = text.match(CJK_CHAR_PATTERN);
  return matches == null ? 0 : matches.length;
}

/**
 * 纯字符统计的保守估算：`ceil(CJK 字符数 × 1.64 + 其余字符数 ÷ 3.35)`。
 * 空串返回 0。
 */
export function estimateTokensCjkAware(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const cjk = countCjkChars(text);
  const rest = text.length - cjk;
  return Math.ceil(cjk * CJK_TOKENS_PER_CHAR + rest / NON_CJK_CHARS_PER_TOKEN);
}
