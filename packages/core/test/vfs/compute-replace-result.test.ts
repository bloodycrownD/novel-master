import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeReplaceResult } from "../../src/domain/vfs/logic/compute-replace-result.js";
import { normalizeForMatch } from "../../src/domain/vfs/logic/normalize-for-match.js";

/** 弯引号常量，方便用例阅读。 */
const LDQ = "\u201C"; // “
const RDQ = "\u201D"; // ”
const LSQ = "\u2018"; // ‘
const RSQ = "\u2019"; // ’
/** 日式引号常量。 */
const LCB = "\u300C"; // 「
const RCB = "\u300D"; // 」
const LWCB = "\u300E"; // 『
const RWCB = "\u300F"; // 』
/** 全角空格。 */
const IDSP = "\u3000";

describe("normalizeForMatch 不变量", () => {
  it("v1 归一化是 1:1 映射，码点数与 UTF-16 码元数都不变", () => {
    const samples = [
      `${LDQ}${RDQ}${LSQ}${RSQ}`, // 弯引号族
      `${LCB}${RCB}${LWCB}${RWCB}`, // 日式引号族
      `a${IDSP}b`, // 全角空格
      "普通中文", // 无映射字符
      `emoji ${LWCB}👨‍👩‍👧${RWCB} end`, // 代理对原样透传
    ];
    for (const s of samples) {
      const n = normalizeForMatch(s);
      assert.equal(
        Array.from(n).length,
        Array.from(s).length,
        `码点数变了: ${s}`,
      );
      assert.equal(n.length, s.length, `UTF-16 码元数变了: ${s}`);
    }
  });
});

describe("computeReplaceResult 单次路径（归一化定位）", () => {
  it("T-B2-01: 文件弯引号 “”、oldString 直引号 → 命中替换", () => {
    // 文件原文用弯引号，oldString 用直引号，归一化后命中。newString 是直引号，
    // 所以命中段被替换成直引号形态；命中段两侧的「他说」「。」原文保留。
    const content = `他说${LDQ}你好${RDQ}。`;
    const result = computeReplaceResult("/a.md", content, `"你好"`, `"嘧"`);
    assert.equal(result.replacements, 1);
    assert.equal(result.nextContent, `他说"嘧"。`);
  });

  it("T-B2-02: 文件日式引号「」、oldString 弯引号 → 命中替换", () => {
    // 文件用日式角引号，oldString 用弯引号，归一化后命中。newString 也是弯引号，
    // 落盘命中段变成弯引号形态；命中段两侧的「他说」「。」原文保留。
    const content = `他说${LCB}你好${RCB}。`;
    const result = computeReplaceResult(
      "/a.md",
      content,
      `${LDQ}你好${RDQ}`,
      `${LDQ}嘧${RDQ}`,
    );
    assert.equal(result.replacements, 1);
    assert.equal(result.nextContent, `他说${LDQ}嘧${RDQ}。`);
  });

  it("T-B2-03: 文件弯引号、oldString 也是弯引号（两侧一致）→ 命中（不破坏正常场景）", () => {
    const content = `他说${LDQ}你好${RDQ}。`;
    const result = computeReplaceResult(
      "/a.md",
      content,
      `${LDQ}你好${RDQ}`,
      `${LDQ}嘧${RDQ}`,
    );
    assert.equal(result.replacements, 1);
    assert.equal(result.nextContent, `他说${LDQ}嘧${RDQ}。`);
  });

  it("T-B2-04: 文件全角空格、oldString 半角空格 → 命中", () => {
    // 文件用全角空格，oldString 用半角空格，归一化后命中。命中段被 newString 替换。
    const content = `foo${IDSP}bar`;
    const result = computeReplaceResult("/a.md", content, "foo bar", "qux bar");
    assert.equal(result.replacements, 1);
    assert.equal(result.nextContent, "qux bar");
  });

  it("T-B2-05: 文件含 emoji（代理对），命中位置邻近 → 切片不截断", () => {
    const content = "前缀👨‍👩‍👧后缀";
    const result = computeReplaceResult("/a.md", content, "后缀", "尾部");
    assert.equal(result.replacements, 1);
    assert.equal(result.nextContent, "前缀👨‍👩‍👧尾部");
  });

  it("T-B2-06: oldString 确实不存在（归一化后也无）→ 抛 REPLACE_NOT_FOUND", () => {
    const content = "hello world";
    assert.throws(
      () => computeReplaceResult("/a.md", content, "不存在", "x"),
      (err: unknown) => {
        const e = err as { code?: string };
        return e.code === "REPLACE_NOT_FOUND";
      },
    );
  });

  it("T-B2-08: 省略号 …… vs ... v1 不归一化，不命中", () => {
    // 省略号是 N:1 映射，v1 推迟，所以这里应当报 NOT_FOUND。
    const content = "等一下……";
    assert.throws(
      () => computeReplaceResult("/a.md", content, "...", "！"),
      (err: unknown) => {
        const e = err as { code?: string };
        return e.code === "REPLACE_NOT_FOUND";
      },
    );
  });
});

describe("computeReplaceResult replaceAll 路径（归一化定位 + 原文切片）", () => {
  it("T-B2-07: replaceAll:true 多处引号变形命中 → 全部替换，未替换段引号原样保留", () => {
    // 文件里三段双引号族形态各不相同：弯双、日式角、直双（本身就能命中）
    // oldString 用直双引号形态，归一化后三处都应命中（双引号族统一归一到直双）。
    const content = [
      `第一${LDQ}词${RDQ}段`, // 弯双引号
      `第二${LCB}词${RCB}段`, // 日式角引号（双引号族）
      `第三"词"段`, // 直双引号（本身就能命中）
    ].join("\n");
    const result = computeReplaceResult(
      "/a.md",
      content,
      `"词"`,
      `「字」`,
      { replaceAll: true },
    );
    assert.equal(result.replacements, 3);
    // 命中段全部替换成 newString；各段的前后原文（含未替换的「第一/第二/第三/段」）原样保留
    assert.equal(
      result.nextContent,
      [
        `第一「字」段`,
        `第二「字」段`,
        `第三「字」段`,
      ].join("\n"),
    );
  });

  it("replaceAll 未替换段的弯引号/日式引号必须原样保留（核心约束）", () => {
    // 这条断言是 P0-1 修复的核心价值：归一化只用于定位，落盘引号不被改写。
    const content = `引子${LDQ}保留${RDQ}。命中${LDQ}目标${RDQ}。结尾${LCB}余${RCB}。`;
    const result = computeReplaceResult(
      "/a.md",
      content,
      `"目标"`,
      `「的」`,
      { replaceAll: true },
    );
    assert.equal(result.replacements, 1);
    // 未替换段的弯引号「保留」、日式角引号「余」都必须原样保留
    assert.equal(
      result.nextContent,
      `引子${LDQ}保留${RDQ}。命中「的」。结尾${LCB}余${RCB}。`,
    );
    // 显式反证：不能出现把弯引号偷偷换成直引号的情况
    assert.ok(!result.nextContent.includes(`"保留"`));
    assert.ok(!result.nextContent.includes(`"余"`));
  });

  it("replaceAll 代理对邻近命中不截断", () => {
    const content = "a👨b👨c";
    const result = computeReplaceResult("/a.md", content, "👨", "🧑", {
      replaceAll: true,
    });
    assert.equal(result.replacements, 2);
    assert.equal(result.nextContent, "a🧑b🧑c");
  });

  it("replaceAll 无命中抛 REPLACE_NOT_FOUND（不出现整段原样返回的假成功）", () => {
    assert.throws(
      () =>
        computeReplaceResult("/a.md", "hello", "不存在", "x", {
          replaceAll: true,
        }),
      (err: unknown) => {
        const e = err as { code?: string };
        return e.code === "REPLACE_NOT_FOUND";
      },
    );
  });
});
