/**
 * splitSmartSortHighlightSegments 单测（review-full/C-1：高亮切分 core 单源，
 * fix-spec #11/#14 的边界随单源化落到 core；desktop/mobile 本地复制归 wave2 删除）。
 *
 * @module test/smart-sort-rule/split-smart-sort-highlight-segments.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitSmartSortHighlightSegments } from "../../src/domain/smart-sort-rule/logic/split-smart-sort-highlight-segments.js";
import { matchSmartSortPattern } from "../../src/domain/smart-sort-rule/logic/match-smart-sort-pattern.js";

function ok(
  result: ReturnType<typeof matchSmartSortPattern>
): asserts result is { ok: true; matches: readonly { index: number; text: string }[] } {
  assert.equal(result.ok, true, `期望成功结果，实际 ${JSON.stringify(result)}`);
}

describe("splitSmartSortHighlightSegments (高亮切分单源)", () => {
  it("普通交替切分：普通段/匹配段交错，偏移来自原生 index（重复文本不漂移）", () => {
    const text = "序 第1章 间 第1章 尾";
    // 重复出现同一匹配文本「第1章」：indexOf 式回查会漂，原生 index 不会。
    const result = matchSmartSortPattern("第[0-9]+章", "", text);
    ok(result);
    // SmartSortPatternMatch 是 {index, text} 的超集，结构兼容直接透传。
    const segments = splitSmartSortHighlightSegments(text, result.matches);
    assert.deepEqual(segments, [
      { text: "序 ", matched: false },
      { text: "第1章", matched: true },
      { text: " 间 ", matched: false },
      { text: "第1章", matched: true },
      { text: " 尾", matched: false },
    ]);
  });

  it("零宽匹配不产生空段且后续段偏移不漂移", () => {
    // /a*/g 在 "aab" 上产出 {0,"aa"}、{2,""}、{3,""}：两个零宽匹配均不产生
    // 空匹配段、cursor 不后移，后续普通段 "b" 偏移不漂移。
    const text = "aab";
    const result = matchSmartSortPattern("a*", "", text);
    ok(result);
    const segments = splitSmartSortHighlightSegments(text, result.matches);
    assert.deepEqual(segments, [
      { text: "aa", matched: true },
      { text: "b", matched: false },
    ]);
    // 全零宽匹配（无任何非零宽命中）：无空段；零宽 index 逐位推进使普通段
    // 按位切开（拼回原文等价，渲染均 unmatched，与双端既有行为逐行一致）。
    const allZero = matchSmartSortPattern("x*", "", "ab");
    ok(allZero);
    assert.deepEqual(
      splitSmartSortHighlightSegments("ab", allZero.matches),
      [
        { text: "a", matched: false },
        { text: "b", matched: false },
      ]
    );
  });

  it("末尾匹配无尾段（匹配恰好收在文本末尾时不追加空普通段）", () => {
    // 前置普通段 + 末尾匹配：无尾段。
    const result = matchSmartSortPattern("第[0-9]+章", "", "序 第1章");
    ok(result);
    assert.deepEqual(
      splitSmartSortHighlightSegments("序 第1章", result.matches),
      [
        { text: "序 ", matched: false },
        { text: "第1章", matched: true },
      ]
    );
    // 匹配覆盖全文：仅一个匹配段，无头尾普通段。
    const full = matchSmartSortPattern("第[0-9]+章", "", "第12章");
    ok(full);
    assert.deepEqual(
      splitSmartSortHighlightSegments("第12章", full.matches),
      [{ text: "第12章", matched: true }]
    );
  });

  it("无匹配整段普通；空文本无匹配为空数组", () => {
    assert.deepEqual(
      splitSmartSortHighlightSegments("没有任何命中", []),
      [{ text: "没有任何命中", matched: false }]
    );
    assert.deepEqual(splitSmartSortHighlightSegments("", []), []);
  });
});
