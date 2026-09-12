import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPatternInput,
  parsePatternInput,
} from "../../src/domain/smart-sort-rule/logic/parse-pattern-input.js";

describe("parsePatternInput (spec smart-filename-sort: /pattern/flags literal)", () => {
  it("literal with flags: /第(\\d+)章/i splits body and flags", () => {
    assert.deepEqual(parsePatternInput("/第(\\d+)章/i"), {
      pattern: "第(\\d+)章",
      flags: "i",
    });
  });

  it("bare input without leading / stays whole with empty flags", () => {
    assert.deepEqual(parsePatternInput("第(\\d+)章"), {
      pattern: "第(\\d+)章",
      flags: "",
    });
  });

  it("literal with empty flags keeps escaped slash inside body", () => {
    assert.deepEqual(parsePatternInput("/a\\/b/"), {
      pattern: "a\\/b",
      flags: "",
    });
  });

  it("multi-char flags: /x/gi and single /x/m", () => {
    assert.deepEqual(parsePatternInput("/x/gi"), { pattern: "x", flags: "gi" });
    assert.deepEqual(parsePatternInput("/x/m"), { pattern: "x", flags: "m" });
  });

  it("invalid flag chars (/x/q) degrade to whole-input bare pattern", () => {
    assert.deepEqual(parsePatternInput("/x/q"), {
      pattern: "/x/q",
      flags: "",
    });
  });

  it("empty body // is not a JS literal — degrades to bare pattern", () => {
    // JS 字面量语义里没有空正则字面量（// 是注释），整串当裸 pattern。
    assert.deepEqual(parsePatternInput("//"), { pattern: "//", flags: "" });
  });

  it("body containing escaped slashes splits at the rightmost unescaped delimiter", () => {
    assert.deepEqual(parsePatternInput("/^\\/a\\//i"), {
      pattern: "^\\/a\\/",
      flags: "i",
    });
  });

  it("unclosed literal (/x or single /) degrades to bare pattern", () => {
    assert.deepEqual(parsePatternInput("/x"), { pattern: "/x", flags: "" });
    assert.deepEqual(parsePatternInput("/"), { pattern: "/", flags: "" });
  });

  it("unescaped / inside body (/a/b/i) degrades to bare pattern", () => {
    // JS 解析器会在最短 body 处停（body=a, flags=b/i 非法）→ 整串裸。
    assert.deepEqual(parsePatternInput("/a/b/i"), {
      pattern: "/a/b/i",
      flags: "",
    });
  });

  it("repeated flag chars (/x/ii) are invalid — bare pattern", () => {
    // 与 schema 层 assertFlagsValid「不重复」口径一致。
    assert.deepEqual(parsePatternInput("/x/ii"), {
      pattern: "/x/ii",
      flags: "",
    });
  });

  it("trailing whitespace breaks the flags tail — bare pattern", () => {
    assert.deepEqual(parsePatternInput("/x/i "), {
      pattern: "/x/i ",
      flags: "",
    });
  });

  it("empty input parses to empty pattern and flags", () => {
    assert.deepEqual(parsePatternInput(""), { pattern: "", flags: "" });
  });

  it("literal with full flag alphabet /x/gimsuy", () => {
    assert.deepEqual(parsePatternInput("/x/gimsuy"), {
      pattern: "x",
      flags: "gimsuy",
    });
  });
});

describe("formatPatternInput (edit echo-back)", () => {
  it("empty flags render bare pattern", () => {
    assert.equal(formatPatternInput("第(\\d+)章", ""), "第(\\d+)章");
  });

  it("non-empty flags render /pattern/flags", () => {
    assert.equal(formatPatternInput("第(\\d+)章", "i"), "/第(\\d+)章/i");
    assert.equal(formatPatternInput("x", "gi"), "/x/gi");
  });

  it("unescaped / in pattern is escaped so the literal stays parseable", () => {
    assert.equal(formatPatternInput("a/b", "gi"), "/a\\/b/gi");
  });

  it("already-escaped slashes are left untouched", () => {
    assert.equal(formatPatternInput("a\\/b", "i"), "/a\\/b/i");
    assert.equal(formatPatternInput("a\\/b", ""), "a\\/b");
  });

  it("round-trips: format → parse recovers pattern + flags (escape-normalized)", () => {
    // 已转义形态的字面精确 round-trip：format 不动 \/，parse 原样保留 body。
    const exact: Array<[string, string]> = [
      ["第(\\d+)章", ""],
      ["第(\\d+)章", "i"],
      ["^\\/a\\/", "i"],
      ["a\\/b", "m"],
      ["x", "gimsuy"],
    ];
    for (const [pattern, flags] of exact) {
      const formatted = formatPatternInput(pattern, flags);
      assert.deepEqual(
        parsePatternInput(formatted),
        { pattern, flags },
        `round-trip failed for ${formatted}`,
      );
    }
    // 未转义 / 的 pattern（多经 CLI/YAML 存入）：format 会转义为 \/（语义等价，
    // \/ 与 / 在正则中同义），flags 精确保留、pattern 规范化为转义形态。
    assert.deepEqual(parsePatternInput(formatPatternInput("a/b", "gi")), {
      pattern: "a\\/b",
      flags: "gi",
    });
  });
});
