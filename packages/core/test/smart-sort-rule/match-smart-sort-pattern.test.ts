/**
 * matchSmartSortPattern 单测（fix ②：编辑器测试预览的正则匹配核心）。
 *
 * @module test/smart-sort-rule/match-smart-sort-pattern.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  matchSmartSortPattern,
  type SmartSortPatternMatch,
} from "../../src/domain/smart-sort-rule/logic/match-smart-sort-pattern.js";

function ok(
  result: ReturnType<typeof matchSmartSortPattern>
): asserts result is { ok: true; matches: readonly SmartSortPatternMatch[] } {
  assert.equal(result.ok, true, `期望成功结果，实际 ${JSON.stringify(result)}`);
}

describe("matchSmartSortPattern (正则测试预览核心)", () => {
  it("非 global flags 也找出全部匹配（内部克隆追加 g）", () => {
    const result = matchSmartSortPattern("第[0-9]+章", "", "第1章开头 第22章结尾");
    ok(result);
    assert.deepEqual(
      result.matches.map((m) => m.text),
      ["第1章", "第22章"]
    );
  });

  it("global flags 语义不重复（flags 已含 g 时正常迭代）", () => {
    const result = matchSmartSortPattern("第[0-9]+章", "g", "第1章 第22章");
    ok(result);
    assert.equal(result.matches.length, 2);
  });

  it("捕获组逐组列出（多组全命中）", () => {
    const result = matchSmartSortPattern(
      "第([0-9]+)卷第([0-9]+)章",
      "",
      "第2卷第13章"
    );
    ok(result);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]!.text, "第2卷第13章");
    assert.deepEqual(result.matches[0]!.groups, ["2", "13"]);
  });

  it("未参与匹配的可选组为 null（GUI 渲染为 '-'）", () => {
    const result = matchSmartSortPattern(
      "第([0-9]+)章(?:[ \\t]+(\\S+))?",
      "",
      "第3章\n第4章 风起"
    );
    ok(result);
    assert.equal(result.matches.length, 2);
    assert.deepEqual(result.matches[0]!.groups, ["3", null]);
    assert.deepEqual(result.matches[1]!.groups, ["4", "风起"]);
  });

  it("非法正则返回 ok:false + 引擎错误消息（不 throw）", () => {
    const result = matchSmartSortPattern("第([0-9+)章", "", "第1章");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.length > 0, "错误消息非空");
    }
  });

  it("非法 flags 返回 ok:false（如 flags 含非法字符由 RegExp 构造报错）", () => {
    const result = matchSmartSortPattern("x", "q", "x");
    assert.equal(result.ok, false);
  });

  it("无匹配返回空 matches（ok 仍为 true）", () => {
    const result = matchSmartSortPattern("第[0-9]+章", "", "Chapter 1");
    ok(result);
    assert.deepEqual(result.matches, []);
  });

  it("flags 含 g 时重复调用互不污染（lastIndex 不外泄）", () => {
    for (let i = 0; i < 2; i++) {
      const result = matchSmartSortPattern("a+", "g", "aa b aaa");
      ok(result);
      assert.deepEqual(
        result.matches.map((m) => m.text),
        ["aa", "aaa"],
        `第 ${i + 1} 次调用结果漂移（lastIndex 状态泄漏）`
      );
    }
  });

  it("大小写 flags 生效（'i' 命中小写形态）", () => {
    const result = matchSmartSortPattern(
      "(?:chapter)[ \\t]*([0-9]+)",
      "i",
      "chapter 12\nChapter 3"
    );
    ok(result);
    assert.deepEqual(
      result.matches.map((m) => m.groups),
      [["12"], ["3"]]
    );
  });

  it("零宽匹配不死循环（matchAll 内部推进 lastIndex）", () => {
    const result = matchSmartSortPattern("x*", "", "abc");
    ok(result);
    // matchAll 对零宽匹配按引擎语义逐位推进，返回有限个结果。
    assert.ok(result.matches.length >= 1 && result.matches.length <= 4);
  });
});
