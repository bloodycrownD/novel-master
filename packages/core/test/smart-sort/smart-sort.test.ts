import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareSmartBasenames,
  extractSortKey,
  extractSortKeyDetail,
  formatSortTupleForDisplay,
  parseChineseNum,
  tokenizeNatural,
  type CompiledSmartSortRule,
  type SmartSortKeyCache,
} from "../../src/domain/workplace/logic/smart-sort.js";

function compile(
  ruleId: string,
  pattern: string,
  flags = "",
): CompiledSmartSortRule {
  return { ruleId, name: ruleId, regex: new RegExp(pattern, flags), captureKind: "smart" };
}

/** fixed 档编译 helper（D13）：无捕获组 pattern 合法，哨兵元组优先。 */
function compileFixed(
  ruleId: string,
  pattern: string,
  captureKind: "fixed_min" | "fixed_max",
): CompiledSmartSortRule {
  return { ruleId, name: ruleId, regex: new RegExp(pattern), captureKind };
}

/** Decorate-sort-undecorate: pre-extract one key per basename (D5). */
function decorate(
  names: readonly string[],
  rules: readonly CompiledSmartSortRule[],
): SmartSortKeyCache {
  const cache: SmartSortKeyCache = new Map();
  for (const name of names) {
    cache.set(name, extractSortKey(name, rules));
  }
  return cache;
}

function sortSmart(
  names: readonly string[],
  rules: readonly CompiledSmartSortRule[],
  order: "asc" | "desc" = "asc",
): string[] {
  const cache = decorate(names, rules);
  return [...names].sort((a, b) => compareSmartBasenames(a, b, order, cache));
}

describe("parseChineseNum (T-SS1)", () => {
  it("converts single and small power-form numerals", () => {
    assert.equal(parseChineseNum("一"), 1);
    assert.equal(parseChineseNum("零"), 0);
    assert.equal(parseChineseNum("两"), 2);
    assert.equal(parseChineseNum("九"), 9);
    assert.equal(parseChineseNum("十"), 10);
    assert.equal(parseChineseNum("十一"), 11);
    assert.equal(parseChineseNum("二十"), 20);
    assert.equal(parseChineseNum("二十五"), 25);
  });

  it("converts power form with embedded zeros up to the spec boundary", () => {
    assert.equal(parseChineseNum("一百"), 100);
    assert.equal(parseChineseNum("一百零一"), 101);
    assert.equal(parseChineseNum("一千零二十五"), 1025);
    assert.equal(parseChineseNum("两千零一"), 2001);
    // T-SS1 点名边界：「一」~「一万零一百零一」
    assert.equal(parseChineseNum("一万零一百零一"), 10101);
  });

  it("converts positional form digit-by-digit (一零二五 = 1025)", () => {
    assert.equal(parseChineseNum("一零二五"), 1025);
    assert.equal(parseChineseNum("〇〇一二"), 12);
    assert.equal(parseChineseNum("零零"), 0);
  });

  it("converts uppercase numerals (壹贰叁…拾)", () => {
    assert.equal(parseChineseNum("壹"), 1);
    assert.equal(parseChineseNum("玖"), 9);
    assert.equal(parseChineseNum("壹佰贰拾叁"), 123);
    assert.equal(parseChineseNum("贰仟零壹"), 2001);
  });

  it("handles unit abbreviations (一千二 = 1200) and 亿-level carry", () => {
    assert.equal(parseChineseNum("一千二"), 1200);
    assert.equal(parseChineseNum("两千五"), 2500);
    assert.equal(parseChineseNum("十二亿"), 1200000000);
    assert.equal(parseChineseNum("一万亿"), 1000000000000);
  });

  it("converts whole ASCII integer runs via Number(), keeping leading zeros", () => {
    assert.equal(parseChineseNum("001"), 1);
    assert.equal(parseChineseNum("2024"), 2024);
    assert.equal(parseChineseNum("００１"), 1); // full-width digits fold to half-width
  });

  it("returns null for digit runs that overflow Number() to ±Infinity (core/B-4)", () => {
    // ~309 位以上的纯数字串经 Number() 溢出为 ±Infinity，与 fixed_min/max
    // 哨兵元组数值平权；必须按「转换失败」返回 null，数字管道永不产出 ±Infinity。
    assert.equal(parseChineseNum("9".repeat(400)), null);
    assert.equal(parseChineseNum(`-${"9".repeat(400)}`), null);
    // 中文逐位分支同型溢出："一"*400 → digits 400 位 → Infinity → null。
    assert.equal(parseChineseNum("一".repeat(400)), null);
    // 仍在有限范围内的长数字串正常返回（10^299 < Number.MAX_VALUE）。
    const finite = parseChineseNum(`1${"0".repeat(299)}`);
    assert.ok(finite !== null && Number.isFinite(finite));
    assert.equal(finite, 1e299);
  });

  it("returns null for empty / mixed / unknown inputs", () => {
    assert.equal(parseChineseNum(""), null);
    assert.equal(parseChineseNum("  "), null); // whitespace-only collapses to empty
    assert.equal(parseChineseNum("第1章"), null); // mixed CJK + ASCII digit
    assert.equal(parseChineseNum("一二三4"), null);
    assert.equal(parseChineseNum("章"), null);
    assert.equal(parseChineseNum("点五"), null);
    assert.equal(parseChineseNum("1.5"), null);
  });

  it("strips internal whitespace before parsing (legado stringToInt semantics)", () => {
    assert.equal(parseChineseNum(" 一 千 "), 1000);
    assert.equal(parseChineseNum("2 4"), 24);
  });
});

describe("tokenizeNatural (T-SS2)", () => {
  it("splits alternating ASCII-digit / non-digit chunks (digits are exactly 0-9)", () => {
    assert.deepEqual(tokenizeNatural("2.txt"), ["2", ".txt"]);
    assert.deepEqual(tokenizeNatural("10.txt"), ["10", ".txt"]);
    assert.deepEqual(tokenizeNatural("第10话a2"), ["第", "10", "话a", "2"]);
    assert.deepEqual(tokenizeNatural("abc"), ["abc"]);
    assert.deepEqual(tokenizeNatural("007"), ["007"]);
    assert.deepEqual(tokenizeNatural(""), []);
  });

  it("orders numeric chunks by value (2.txt < 10.txt, natural fallback path)", () => {
    // No cache → both ordinal-less → natural order (total-order clause 3).
    assert.ok(compareSmartBasenames("2.txt", "10.txt", "asc") < 0);
    assert.ok(compareSmartBasenames("1.txt", "2.txt", "asc") < 0);
    assert.ok(compareSmartBasenames("第2话.txt", "第10话.txt", "asc") < 0);
  });

  it("orders non-digit chunks by code unit (Chinese code points)", () => {
    // 作 U+4F5C < 公 U+516C < 封 U+5C01 — PRD 验收序列
    assert.ok(compareSmartBasenames("作者的话.txt", "公告.txt", "asc") < 0);
    assert.ok(compareSmartBasenames("公告.txt", "封面.txt", "asc") < 0);
  });

  it("compares mixed chunk types by whole-chunk code unit order", () => {
    // Digit chunk vs non-digit chunk at the same position: code-unit order.
    assert.ok(compareSmartBasenames("1.txt", "a.txt", "asc") < 0); // '1'(0x31) < 'a'(0x61)
    assert.ok(compareSmartBasenames("a1.txt", "aa.txt", "asc") < 0); // '1' < 'a'
  });

  it("breaks digit-tie by chunk length first (007 > 7 by design)", () => {
    // Spec note: length-first is the deterministic design — equal values with
    // leading zeros converge via ordinal extraction + tiebreak instead.
    assert.ok(compareSmartBasenames("007.txt", "7.txt", "asc") > 0);
    assert.ok(compareSmartBasenames("08.txt", "007.txt", "asc") < 0); // 2 digits < 3 digits
  });

  it("orders the shorter exhausted string first", () => {
    assert.ok(compareSmartBasenames("ab", "abc", "asc") < 0);
    assert.ok(compareSmartBasenames("第1章", "第1章外传", "asc") < 0);
  });
});

describe("extractSortKey (T-SS3)", () => {
  const zhChapter = compile("t-zh", "第([0-9〇零一二两三四五六七八九十百千]{1,6})章");

  it("takes the first matching rule by priority", () => {
    const volume = compile("t-volume", "第([0-9]{1,4})卷");
    assert.deepEqual(extractSortKey("第3章", [zhChapter, volume]), [3]);
    assert.deepEqual(extractSortKey("第3卷", [zhChapter, volume]), [3]);
    // Coarse rule wins even though a later rule matches more precisely:
    const coarse = compile("t-coarse", "(\\d+)");
    const strict = compile("t-strict", "^(\\d+)-(\\d+)$");
    assert.deepEqual(extractSortKey("1-2", [coarse, strict]), [1]);
  });

  it("falls through to the next rule when a capture group is unparsable", () => {
    // Group 2 captures "" for 第12章 → unparsable → skip rule 1, use rule 2.
    const broken = compile("t-broken", "(第)章?(\\d*)");
    assert.deepEqual(extractSortKey("第12章", [broken, zhChapter]), [12]);
    // A group that did not participate in the match (undefined) also skips.
    const alt = compile("t-alt", "^(?:a(\\d+)|b(\\d+))$");
    const anyDigit = compile("t-digit", "(\\d+)");
    assert.deepEqual(extractSortKey("b5", [alt, anyDigit]), [5]);
  });

  it("treats an overflowing capture group as a conversion failure and skips the rule (core/B-4)", () => {
    // 400 位数字串经 Number() 溢出为 Infinity：按「任一组转换失败」跳过该
    // 规则（与 unparsable 组同语义），绝不产出 ±Infinity 数字元组与哨兵混序。
    const huge = compile("t-huge", "第(\\d+)章");
    const firstDigit = compile("t-first", "第(\\d)");
    assert.equal(extractSortKey(`第${"9".repeat(400)}章`, [huge]), null);
    assert.deepEqual(
      extractSortKey(`第${"9".repeat(400)}章`, [huge, firstDigit]),
      [9]
    );
  });

  it("defends against zero-capture-group rules by skipping them", () => {
    // Compile-time validation (Step 7) is the real gate; extractSortKey must
    // simply never let such a rule claim the basename.
    const noGroup = compile("t-nogroup", "第\\d+章");
    assert.equal(extractSortKey("第12章", [noGroup, zhChapter])[0], 12);
  });

  it("returns null when nothing matches or no rules are given", () => {
    assert.equal(extractSortKey("公告.txt", [zhChapter]), null);
    assert.equal(extractSortKey("第12章", []), null);
  });

  it("converts Chinese-numeral capture groups into values", () => {
    assert.deepEqual(extractSortKey("第十二章.txt", [zhChapter]), [12]);
    assert.deepEqual(extractSortKey("第两千零一章.txt", [zhChapter]), [2001]);
  });

  it("D13 fixed 档：命中即哨兵元组，忽略捕获组管道", () => {
    const prologue = compileFixed("t-prologue", "^(序章?|楔子|引子)", "fixed_min");
    const finale = compileFixed("t-finale", "^(终章|尾声|后记)", "fixed_max");
    // 无捕获组 pattern：fixed 档照常命中（捕获组被忽略，语义固定元组优先）。
    const detailMin = extractSortKeyDetail("序章 起源.txt", [prologue]);
    assert.equal(detailMin?.ruleId, "t-prologue");
    assert.equal(detailMin?.nums[0], -Infinity);
    const detailMax = extractSortKeyDetail("终章 大结局.txt", [finale]);
    assert.equal(detailMax?.ruleId, "t-finale");
    assert.equal(detailMax?.nums[0], Infinity);
    // 捕获组与 fixed 档共存：捕获组存在但被忽略（仍哨兵元组）。
    const withGroups = {
      ...compileFixed("t-extra", "^(番外|外传)", "fixed_max"),
      regex: new RegExp("^(番外|外传)([0-9]+)"),
    };
    assert.equal(extractSortKeyDetail("番外3.txt", [withGroups])?.nums[0], Infinity);
    // smart 档行为零变化：未命中 fixed 规则的名字照旧走捕获组管道。
    assert.deepEqual(extractSortKey("第一章.txt", [prologue, zhChapter]), [1]);
  });
});

describe("compareSmartBasenames total order (T-SS4)", () => {
  const rules: CompiledSmartSortRule[] = [
    compile("t-vol-ch", "第([0-9]{1,4})卷[-—·.、]?第([0-9]{1,4})章"),
    compile("t-vol", "第([0-9]{1,4})卷"),
    compile("t-ch", "第([0-9〇零一二两三四五六七八九十百千]{1,6})章"),
  ];

  it("clause 1: names with ordinals sort before ordinal-less names", () => {
    assert.deepEqual(sortSmart(["公告.txt", "第一章.txt", "封面.txt"], rules), [
      "第一章.txt",
      "公告.txt",
      "封面.txt",
    ]);
    assert.ok(compareSmartBasenames("第一章", "公告", "asc", decorate(["第一章", "公告"], rules)) < 0);
  });

  it("clause 2: tuples compare element-wise; equal prefix → shorter first", () => {
    // Element-wise: [2,1] after [1,9] (volume wins, not chapter).
    assert.deepEqual(
      sortSmart(["第2卷-第1章", "第1卷-第9章"], rules),
      ["第1卷-第9章", "第2卷-第1章"],
    );
    // Equal prefix [1] vs [1,3] → shorter tuple first.
    assert.deepEqual(sortSmart(["第1卷-第3章", "第1卷"], rules), ["第1卷", "第1卷-第3章"]);
  });

  it("clause 3: ordinal-less names fall back to natural order", () => {
    assert.deepEqual(
      sortSmart(["公告.txt", "作者的话.txt", "封面.txt"], rules),
      ["作者的话.txt", "公告.txt", "封面.txt"],
    );
    assert.deepEqual(sortSmart(["第10话.txt", "第2话.txt"], rules), ["第2话.txt", "第10话.txt"]);
  });

  it("clause 4: equal ordinals tiebreak by raw filename (第1章 vs 第一章)", () => {
    // Same ordinal [1]; '1' (0x31) < '一' (U+4E00) → 第1章 first, deterministically.
    assert.deepEqual(sortSmart(["第一章.txt", "第1章.txt"], rules), ["第1章.txt", "第一章.txt"]);
    // PRD acceptance sequence, verbatim.
    assert.deepEqual(
      sortSmart(
        ["第十一章.txt", "第十章.txt", "第二章.txt", "第一章.txt", "第2章.txt"],
        rules,
      ),
      ["第一章.txt", "第2章.txt", "第二章.txt", "第十章.txt", "第十一章.txt"],
    );
  });

  it("clause 5: desc is the strict reversal of the whole order", () => {
    const names = ["第十一章.txt", "公告.txt", "第2章.txt", "第1卷-第3章", "第1卷"];
    const asc = sortSmart(names, rules, "asc");
    const desc = sortSmart(names, rules, "desc");
    assert.deepEqual(desc, [...asc].reverse());
    // Pairwise: compare(desc) === -compare(asc) for every distinct pair.
    const cache = decorate(names, rules);
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        assert.equal(
          compareSmartBasenames(a, b, "desc", cache),
          -compareSmartBasenames(a, b, "asc", cache),
        );
      }
    }
  });

  it("PRD acceptance: volume-then-chapter compound ordinals", () => {
    assert.deepEqual(
      sortSmart(["第1卷-第5章", "第2卷-第1章", "第1卷-第3章"], rules),
      ["第1卷-第3章", "第1卷-第5章", "第2卷-第1章"],
    );
  });

  it("D13 fixed 档全序：fixed_min 排一切序号前、fixed_max 沉底、同值文件名决胜、desc 取反", () => {
    const fixedRules: CompiledSmartSortRule[] = [
      ...rules,
      compileFixed("t-prologue", "^(序章?|楔子|引子)", "fixed_min"),
      compileFixed("t-finale", "^(终章|尾声|后记)", "fixed_max"),
      compileFixed("t-extra", "^(番外|外传)", "fixed_max"),
    ];
    // fixed_min 排 (0,) 前；fixed_max 排 (999999,) 后。
    const zero = compile("t-zero", "^第([0-9]{1,6})章");
    assert.deepEqual(
      sortSmart(["第0章.txt", "序章.txt", "终章.txt"], [zero, fixedRules[3]!, fixedRules[4]!]),
      ["序章.txt", "第0章.txt", "终章.txt"],
    );
    const big = compile("t-big", "^第([0-9]{1,6})章");
    assert.deepEqual(
      sortSmart(["终章.txt", "番外.txt", "第999999章.txt"], [big, fixedRules[4]!, fixedRules[5]!]),
      ["第999999章.txt", "番外.txt", "终章.txt"],
    );
    // 双 fixed_max 同值：按原文件名自然序决胜。「番」U+756A <「终」U+7EC8，
    // 故番外排在终章前（D13 定稿：同值 tiebreak 接受现状，测试锁行为）。
    assert.deepEqual(
      sortSmart(["终章.txt", "番外.txt"], [fixedRules[4]!, fixedRules[5]!]),
      ["番外.txt", "终章.txt"],
    );
    // 冒烟序列（任务定稿样例）：序章 → 第一章 → 第十章 →（fixed_max 同值
    // 文件名决胜：番外 < 终章）。
    assert.deepEqual(
      sortSmart(
        ["终章.txt", "第十章.txt", "序章.txt", "番外.txt", "第一章.txt"],
        fixedRules,
      ),
      ["序章.txt", "第一章.txt", "第十章.txt", "番外.txt", "终章.txt"],
    );
    // 降序取反：哨兵元组随之反转（fixed_min 沉底、fixed_max 置顶）。
    const names = ["序章.txt", "第一章.txt", "第十章.txt", "番外.txt", "终章.txt"];
    const asc = sortSmart(names, fixedRules, "asc");
    const desc = sortSmart(names, fixedRules, "desc");
    assert.deepEqual(desc, [...asc].reverse());
  });

  it("D13 formatSortTupleForDisplay：数字元组/哨兵文案", () => {
    assert.equal(formatSortTupleForDisplay([12]), "(12,)");
    assert.equal(formatSortTupleForDisplay([2, 13]), "(2,13,)");
    assert.equal(formatSortTupleForDisplay([-Infinity]), "(固定最小,)");
    assert.equal(formatSortTupleForDisplay([Infinity]), "(固定最大,)");
  });
});

describe("builtin rule set, appendix A verbatim (T-SS5)", () => {
  // 附录 A 原文内联（NUM 字符类 + 七条 pattern/flags 一字不改，D13 后
  // 含三条 fixed 档）；不 import bootstrap 常量——并行节点负责 seed 落库，
  // 这里只验语义。
  const NUM = "[0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}";
  const builtinRules: CompiledSmartSortRule[] = [
    compileFixed("builtin-zh-prologue", "^(序章?|楔子|引子|前言|开篇)", "fixed_min"),
    compileFixed("builtin-zh-finale", "^(终章|尾声|后记|完结|finale)", "fixed_max"),
    compileFixed("builtin-zh-extra", "^(番外|外传|if篇?)", "fixed_max"),
    compile(
      "builtin-zh-volume-chapter",
      `第[ \\t]{0,2}(${NUM})[ \\t]{0,2}卷[ \\t]*[-—·.、]?[ \\t]*第[ \\t]{0,2}(${NUM})[ \\t]{0,2}章`,
    ),
    compile("builtin-zh-chapter", `第[ \\t]{0,2}(${NUM})[ \\t]{0,2}(?:章|节|集|部|篇|回|卷)`),
    compile(
      "builtin-en-chapter",
      "(?:chapter|section|part|episode)[ \\t]*[.．]?[ \\t]*([0-9]{1,6})",
      "i",
    ),
    compile("builtin-numeric", "^[ \\t]*([0-9]{1,6})[ \\t]*(?:[、.．\\-—_]|$)"),
  ];
  const [, , , volumeChapter, zhChapter, enChapter, numeric] = builtinRules;

  it("D13 fixed 三条：序章类哨兵排最前、终章/番外类沉底", () => {
    const prologue = extractSortKeyDetail("楔子 起源", builtinRules);
    assert.equal(prologue?.ruleId, "builtin-zh-prologue");
    assert.equal(prologue?.nums[0], -Infinity);
    const finale = extractSortKeyDetail("终章 大结局", builtinRules);
    assert.equal(finale?.ruleId, "builtin-zh-finale");
    assert.equal(finale?.nums[0], Infinity);
    const extra = extractSortKeyDetail("番外一 日常", builtinRules);
    assert.equal(extra?.ruleId, "builtin-zh-extra");
    assert.equal(extra?.nums[0], Infinity);
    // 序章类不在开头不命中（pattern 锚定 ^）：退回数字规则。
    assert.deepEqual(extractSortKey("非番外 第一章", builtinRules), [1]);
  });

  it("each builtin rule matches its own example with the right ordinal", () => {
    assert.deepEqual(extractSortKey("第2卷 第13章", [volumeChapter]), [2, 13]);
    assert.deepEqual(extractSortKey("第十二章 风起", [zhChapter]), [12]);
    assert.deepEqual(extractSortKey("Chapter 12", [enChapter]), [12]);
    assert.deepEqual(extractSortKey("001、开端", [numeric]), [1]); // leading zeros → 1
  });

  it("en-chapter is case-insensitive via flags 'i'", () => {
    assert.deepEqual(extractSortKey("chapter 5", [enChapter]), [5]);
    assert.deepEqual(extractSortKey("PART 3", [enChapter]), [3]);
    assert.deepEqual(extractSortKey("Episode.21", [enChapter]), [21]);
  });

  it("zh-volume-chapter must precede zh-chapter (appendix note 1)", () => {
    // zh-chapter alone matches 第2卷 first and would drop the chapter number.
    assert.deepEqual(extractSortKey("第2卷 第13章", [zhChapter]), [2]);
    // With the compound rule first in priority, the full tuple is extracted.
    assert.deepEqual(extractSortKey("第2卷 第13章", builtinRules), [2, 13]);
  });

  it("priority list assigns each example to the intended rule", () => {
    assert.deepEqual(extractSortKey("第2卷 第13章", builtinRules), [2, 13]);
    assert.deepEqual(extractSortKey("第十二章 风起", builtinRules), [12]);
    assert.deepEqual(extractSortKey("Chapter 12", builtinRules), [12]);
    assert.deepEqual(extractSortKey("001、开端", builtinRules), [1]);
  });

  it("directory names 第一卷/第十卷 hit zh-chapter (appendix note 2)", () => {
    assert.deepEqual(extractSortKey("第一卷", builtinRules), [1]);
    assert.deepEqual(extractSortKey("第十卷", builtinRules), [10]);
    assert.deepEqual(sortSmart(["第十卷", "第一卷", "第三卷"], builtinRules), [
      "第一卷",
      "第三卷",
      "第十卷",
    ]);
  });

  it("handles uppercase numerals and larger ordinals through the builtin patterns", () => {
    assert.deepEqual(extractSortKey("第贰卷 第拾叁章", [volumeChapter]), [2, 13]);
    assert.deepEqual(extractSortKey("第一千零一章", [zhChapter]), [1001]);
  });
});
