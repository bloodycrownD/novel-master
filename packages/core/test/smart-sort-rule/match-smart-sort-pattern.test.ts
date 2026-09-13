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
import {
  FIXED_MAX_SORT_TUPLE,
  FIXED_MIN_SORT_TUPLE,
  formatSortTupleForDisplay,
} from "../../src/domain/workplace/logic/smart-sort.js";

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

  it("matches 携带原文起始偏移 index（重复文本/多行不错位，供 GUI 高亮切分）", () => {
    // 重复出现同一文本：indexOf 式回查会漂移，index 必须来自 matchAll 原生偏移。
    const result = matchSmartSortPattern("第[0-9]+章", "", "第1章 第1章\n第12章");
    ok(result);
    assert.deepEqual(
      result.matches.map((m) => ({ text: m.text, index: m.index })),
      [
        { text: "第1章", index: 0 },
        { text: "第1章", index: 4 },
        // 换行计入偏移：第(4)1(5)章(6)\n(7)第(8)1(9)2(10)章(11)。
        { text: "第12章", index: 8 },
      ]
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
    assert.equal(result.matches[0]!.index, 0);
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
    // 零宽匹配 text 为空但 index 严格递增（GUI 切分跳过空段，不重复渲染）。
    const indexes = result.matches.map((m) => m.index);
    for (let i = 1; i < indexes.length; i++) {
      assert.ok(indexes[i]! > indexes[i - 1]!, "零宽匹配 index 严格递增");
    }
    assert.ok(result.matches.every((m) => m.text === ""));
  });
});

describe("matchSmartSortPattern tuple（D13 捕获档位展示字段）", () => {
  it("smart 档（缺省）：捕获组→数字元组格式化为 (12,) 风格", () => {
    const result = matchSmartSortPattern(
      "第([0-9]+)卷第([0-9]+)章",
      "",
      "第2卷第13章 第十二卷第三章"
    );
    ok(result);
    // 阿拉伯数字直取。
    assert.equal(result.matches[0]!.tuple, "(2,13,)");
  });

  it("smart 档：中文数字捕获组经 parseChineseNum 转换", () => {
    const result = matchSmartSortPattern(
      "第([0-9〇零一二两三四五六七八九十百千]+)章",
      "",
      "第十二章"
    );
    ok(result);
    assert.equal(result.matches[0]!.tuple, "(12,)");
  });

  it("smart 档：无捕获组 / 转换失败 → tuple null（GUI 显「无序号」）", () => {
    // 无捕获组：tuple null。
    const noGroup = matchSmartSortPattern("序章|楔子", "", "序章");
    ok(noGroup);
    assert.equal(noGroup.matches[0]!.tuple, null);
    // 捕获组非数字且中文解析失败：tuple null。
    const unparsable = matchSmartSortPattern("第(\\S+)章", "", "第风起章");
    ok(unparsable);
    assert.equal(unparsable.matches[0]!.tuple, null);
    // 多组中任一组失败：整条 null（与提取管道「任一组失败跳过规则」一致）。
    const mixed = matchSmartSortPattern("第([0-9]+)章(?:-(\\S+))?", "", "第3章-风起");
    ok(mixed);
    assert.equal(mixed.matches[0]!.tuple, null);
  });

  it("fixed 档：tuple 恒为哨兵文案，忽略捕获组（有无捕获组均可）", () => {
    // 无捕获组 + fixed_min。
    const minNoGroup = matchSmartSortPattern(
      "^(序章?|楔子|引子)",
      "",
      "楔子 起源",
      "fixed_min"
    );
    ok(minNoGroup);
    assert.equal(minNoGroup.matches[0]!.tuple, "(固定最小,)");
    // 捕获组可解析 + fixed_max：捕获组被忽略，仍显哨兵文案。
    const maxWithGroup = matchSmartSortPattern(
      "^(番外|外传)([0-9]*)",
      "",
      "番外3 日常",
      "fixed_max"
    );
    ok(maxWithGroup);
    assert.equal(maxWithGroup.matches[0]!.groups.length, 2);
    assert.equal(maxWithGroup.matches[0]!.tuple, "(固定最大,)");
    // 捕获组不可解析 + fixed：不影响 tuple（哨兵优先，不参与转换）。
    const minUnparsable = matchSmartSortPattern(
      "^(终章|尾声)(\\S*)",
      "",
      "终章 大结局",
      "fixed_max"
    );
    ok(minUnparsable);
    assert.equal(minUnparsable.matches[0]!.tuple, "(固定最大,)");
  });

  it("tuple 文案与 formatSortTupleForDisplay 同源（C-3 单源锁定）", () => {
    // match 通道不再内联哨兵文案：三档 tuple 必须与权威实现输出逐字一致。
    const min = matchSmartSortPattern("^(序章?|楔子)", "", "序章", "fixed_min");
    ok(min);
    assert.equal(
      min.matches[0]!.tuple,
      formatSortTupleForDisplay(FIXED_MIN_SORT_TUPLE)
    );
    const max = matchSmartSortPattern("^(番外)", "", "番外", "fixed_max");
    ok(max);
    assert.equal(
      max.matches[0]!.tuple,
      formatSortTupleForDisplay(FIXED_MAX_SORT_TUPLE)
    );
    const smart = matchSmartSortPattern(
      "第([0-9]+)卷第([0-9]+)章",
      "",
      "第2卷第13章"
    );
    ok(smart);
    assert.equal(smart.matches[0]!.tuple, formatSortTupleForDisplay([2, 13]));
  });
});
