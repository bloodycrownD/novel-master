/**
 * CJK 感知廉价估算单测：折算公式 + 空串 + 混合文本方向性（中文不低于
 * cl100k 量级、英文小幅高估）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CJK_TOKENS_PER_CHAR,
  estimateTokensCjkAware,
} from "../../../src/infra/tokenizer/logic/estimate-tokens-cjk-aware.js";

describe("estimateTokensCjkAware", () => {
  it("空串 → 0", () => {
    assert.equal(estimateTokensCjkAware(""), 0);
  });

  it("纯中文：每字 ≈ 1.64 token（不低于 cl100k 实测量级）", () => {
    const text = "夜色如水林间小径落满枯叶她停脚步抬头望向灯火阑珊处"; // 22 个 CJK 字符
    const expected = Math.ceil(text.length * CJK_TOKENS_PER_CHAR);
    assert.equal(estimateTokensCjkAware(text), expected);
    // 方向性：远高于 /3.35 英文口径（中文低估八成的问题）
    assert.ok(estimateTokensCjkAware(text) > Math.ceil(text.length / 3.35) * 2);
  });

  it("纯英文：沿用 /3.35 口径（较 cl100k /4 小幅高估，方向安全）", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    assert.equal(estimateTokensCjkAware(text), Math.ceil(text.length / 3.35));
  });

  it("混合文本：CJK 与其余分别折算后求和", () => {
    const cjk = "夜色如水"; // 4 CJK
    const rest = " and some ascii text"; // 20 非 CJK
    const expected = Math.ceil(4 * CJK_TOKENS_PER_CHAR + 20 / 3.35);
    assert.equal(estimateTokensCjkAware(cjk + rest), expected);
  });

  it("假名 / 谚文计入 CJK 段", () => {
    const text = "かな한글"; // 平假名 2 + 谚文 2
    assert.equal(
      estimateTokensCjkAware(text),
      Math.ceil(4 * CJK_TOKENS_PER_CHAR)
    );
  });

  it("CJK 标点（U+3000-303F）计入 CJK 段；全角 ASCII 变体（U+FF00 区）不在正则内（full/C-1 口径锁定）", () => {
    // U+3000-303F（CJK 标点）落在 \u2E80-\u9FFF 区间内 → 按 CJK ×1.64 计。
    const cjkPunct = "。、「」【】"; // 6 个 U+3000-303F 区标点
    assert.equal(
      estimateTokensCjkAware(cjkPunct),
      Math.ceil(6 * CJK_TOKENS_PER_CHAR)
    );
    // 全角 ASCII 变体（，U+FF0C、！U+FF01 等）在 U+FF00-FF5E、不在正则
    // 区间内 → 按非 CJK ÷3.35 宽松处理（低估方向，已知取舍；注释与用例
    // 同口径）。
    const fullwidthAscii = "，！？"; // 3 个 U+FF00 区字符
    assert.equal(
      estimateTokensCjkAware(fullwidthAscii),
      Math.ceil(3 / 3.35)
    );
  });

  it("整数倍 CJK 无浮点偏差的取样锁定：25 字 → 41（25×1.64 恰为精确值）", () => {
    const text = "夜".repeat(25);
    // 25 × 1.64 在 IEEE754 下恰为 41（乘法无偏差）；本用例钉住「公式 =
    // ceil(CJK×1.64 + rest/3.35)」的取样行为——若未来改整数算术或改系数，
    // 本用例会红，届时按拍板同步口径。
    assert.equal(25 * CJK_TOKENS_PER_CHAR, 41);
    assert.equal(estimateTokensCjkAware(text), 41);
  });
});
