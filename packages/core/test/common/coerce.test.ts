import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  Coerce  } from "../../src/common/coerce.js";

describe("common/coerce · Coerce.string", () => {
    it("字符串原样返回；非字符串 → 空串", () => {
        assert.equal(Coerce.string("x"), "x");
        assert.equal(Coerce.string(""), "");
        assert.equal(Coerce.string(" "), " ");
        assert.equal(Coerce.string(null), "");
        assert.equal(Coerce.string(undefined), "");
        assert.equal(Coerce.string(42), "");
        assert.equal(Coerce.string(Number.NaN), "");
        assert.equal(Coerce.string(Number.POSITIVE_INFINITY), "");
        assert.equal(Coerce.string({ a: 1 }), "");
        assert.equal(Coerce.string([1]), "");
        assert.equal(Coerce.string(true), "");
    });
});

describe("common/coerce · Coerce.nullableText", () => {
    it("null / undefined → null；其余 String 化", () => {
        assert.equal(Coerce.nullableText(null), null);
        assert.equal(Coerce.nullableText(undefined), null);
        assert.equal(Coerce.nullableText(""), "");
        assert.equal(Coerce.nullableText(0), "0");
        assert.equal(Coerce.nullableText(42), "42");
        assert.equal(Coerce.nullableText(false), "false");
        assert.equal(Coerce.nullableText(Number.NaN), "NaN");
    });

    it("与 Coerce.string 的 null 边界不同：'' vs null", () => {
        assert.equal(Coerce.string(null), "");
        assert.equal(Coerce.nullableText(null), null);
    });
});

describe("common/coerce · Coerce.strictText", () => {
    it("只有 string 通过（空串原样保留）", () => {
        assert.equal(Coerce.strictText(""), "");
        assert.equal(Coerce.strictText("  x  "), "  x  ");
    });

    it("数字 / 布尔 / 对象 / null 一律 null（不做 String 化）", () => {
        assert.equal(Coerce.strictText(42), null);
        assert.equal(Coerce.strictText(0), null);
        assert.equal(Coerce.strictText(false), null);
        assert.equal(Coerce.strictText(null), null);
        assert.equal(Coerce.strictText(undefined), null);
        assert.equal(Coerce.strictText({a: 1}), null);
        assert.equal(Coerce.strictText(["x"]), null);
    });

    it("与宽松版 nullableText 的语义差：数字不 String 化", () => {
        assert.equal(Coerce.nullableText(42), "42");
        assert.equal(Coerce.strictText(42), null);
    });
});

describe("common/coerce · Coerce.integerAtLeast", () => {
    it("整数 / 数字字符串且达到 min → 数字", () => {
        assert.equal(Coerce.integerAtLeast(3, 1), 3);
        assert.equal(Coerce.integerAtLeast(0, 0), 0);
        assert.equal(Coerce.integerAtLeast("-3", -3), -3);
        assert.equal(Coerce.integerAtLeast("3", 1), 3);
        assert.equal(Coerce.integerAtLeast(" 3 ", 1), 3);
    });

    it("小数 / 非数字 / 越界 / NaN / Infinity → undefined", () => {
        assert.equal(Coerce.integerAtLeast(3.5, 1), undefined);
        assert.equal(Coerce.integerAtLeast(0, 1), undefined);
        assert.equal(Coerce.integerAtLeast("3.5", 1), undefined);
        assert.equal(Coerce.integerAtLeast("", 0), undefined);
        assert.equal(Coerce.integerAtLeast(" ", 0), undefined);
        assert.equal(Coerce.integerAtLeast("x", 0), undefined);
        assert.equal(Coerce.integerAtLeast(Number.NaN, 0), undefined);
        assert.equal(Coerce.integerAtLeast(Number.POSITIVE_INFINITY, 0), undefined);
        assert.equal(Coerce.integerAtLeast(true, 0), undefined);
    });
});

describe("common/coerce · Coerce.number", () => {
    it("有限数字（含数字字符串）→ number", () => {
        assert.equal(Coerce.number(12), 12);
        assert.equal(Coerce.number(12.5), 12.5);
        assert.equal(Coerce.number(0), 0);
        assert.equal(Coerce.number(-3.5), -3.5);
        assert.equal(Coerce.number("12"), 12);
        assert.equal(Coerce.number("12.5"), 12.5);
        assert.equal(Coerce.number(" 3 "), 3);
        assert.equal(Coerce.number("1e3"), 1000);
    });

    it("空串 / 空白串 / 非数字 / NaN / Infinity / 非原始类型 → undefined", () => {
        assert.equal(Coerce.number(""), undefined);
        assert.equal(Coerce.number(" "), undefined);
        assert.equal(Coerce.number(" \t\n"), undefined);
        assert.equal(Coerce.number("abc"), undefined);
        assert.equal(Coerce.number("Infinity"), undefined);
        assert.equal(Coerce.number(Number.NaN), undefined);
        assert.equal(Coerce.number(Number.POSITIVE_INFINITY), undefined);
        assert.equal(Coerce.number(Number.NEGATIVE_INFINITY), undefined);
        assert.equal(Coerce.number(null), undefined);
        assert.equal(Coerce.number(undefined), undefined);
        assert.equal(Coerce.number(true), undefined);
        assert.equal(Coerce.number(false), undefined);
        assert.equal(Coerce.number({}), undefined);
        assert.equal(Coerce.number([]), undefined);
    });
});

describe("common/coerce · Coerce.strictNumber", () => {
    it("只有有限 number 通过（含 0 / 负数 / 小数）", () => {
        assert.equal(Coerce.strictNumber(0), 0);
        assert.equal(Coerce.strictNumber(-3.5), -3.5);
        assert.equal(Coerce.strictNumber(12), 12);
    });

    it("数字字符串 / NaN / ±Infinity / 非原始类型一律 null（不解析）", () => {
        assert.equal(Coerce.strictNumber("12"), null);
        assert.equal(Coerce.strictNumber("0"), null);
        assert.equal(Coerce.strictNumber(Number.NaN), null);
        assert.equal(Coerce.strictNumber(Number.POSITIVE_INFINITY), null);
        assert.equal(Coerce.strictNumber(Number.NEGATIVE_INFINITY), null);
        assert.equal(Coerce.strictNumber(null), null);
        assert.equal(Coerce.strictNumber(undefined), null);
        assert.equal(Coerce.strictNumber(true), null);
        assert.equal(Coerce.strictNumber({}), null);
    });

    it("与宽松版 number 的语义差：数字字符串不解析", () => {
        assert.equal(Coerce.number("12"), 12);
        assert.equal(Coerce.strictNumber("12"), null);
    });
});

describe("common/coerce · Coerce.nonNegativeNumber", () => {
    it("非负数字（含数字字符串）→ number", () => {
        assert.equal(Coerce.nonNegativeNumber(0), 0);
        assert.equal(Coerce.nonNegativeNumber(12.5), 12.5);
        assert.equal(Coerce.nonNegativeNumber("12"), 12);
        assert.equal(Coerce.nonNegativeNumber("0"), 0);
    });

    it("负数 / 非数字 / NaN / Infinity / 空值 → undefined", () => {
        assert.equal(Coerce.nonNegativeNumber(-1), undefined);
        assert.equal(Coerce.nonNegativeNumber(-0.5), undefined);
        assert.equal(Coerce.nonNegativeNumber("-1"), undefined);
        assert.equal(Coerce.nonNegativeNumber(Number.NaN), undefined);
        assert.equal(Coerce.nonNegativeNumber(Number.POSITIVE_INFINITY), undefined);
        assert.equal(Coerce.nonNegativeNumber("abc"), undefined);
        assert.equal(Coerce.nonNegativeNumber(""), undefined);
        assert.equal(Coerce.nonNegativeNumber(" "), undefined);
        assert.equal(Coerce.nonNegativeNumber(null), undefined);
        assert.equal(Coerce.nonNegativeNumber(undefined), undefined);
    });
});

describe("common/coerce · Coerce.nonEmptyText", () => {
    it("trim 后非空的字符串 → 原字符串（不做 trim）", () => {
        assert.equal(Coerce.nonEmptyText("x"), "x");
        assert.equal(Coerce.nonEmptyText(" x "), " x ");
        assert.equal(Coerce.nonEmptyText("中"), "中");
    });

    it("空串 / 空白串 / 非字符串 → null", () => {
        assert.equal(Coerce.nonEmptyText(""), null);
        assert.equal(Coerce.nonEmptyText("   "), null);
        assert.equal(Coerce.nonEmptyText("\t\n"), null);
        assert.equal(Coerce.nonEmptyText(42), null);
        assert.equal(Coerce.nonEmptyText(null), null);
        assert.equal(Coerce.nonEmptyText(undefined), null);
        assert.equal(Coerce.nonEmptyText({}), null);
        assert.equal(Coerce.nonEmptyText([]), null);
    });
});

describe("common/coerce · Coerce.record", () => {
    it("JSON 对象文本 → Record（含 BOM）", () => {
        assert.deepEqual(Coerce.record('{"a":1}'), { a: 1 });
        assert.deepEqual(Coerce.record('\uFEFF{"a":1}'), { a: 1 });
        assert.deepEqual(Coerce.record("{}"), {});
    });

    it("非对象 JSON / 解析失败 / 空值 → null", () => {
        assert.equal(Coerce.record("[]"), null);
        assert.equal(Coerce.record("null"), null);
        assert.equal(Coerce.record("1"), null);
        assert.equal(Coerce.record('"text"'), null);
        assert.equal(Coerce.record("not json"), null);
        assert.equal(Coerce.record(""), null);
        assert.equal(Coerce.record(null), null);
        assert.equal(Coerce.record(undefined), null);
    });
});

describe("common/coerce · Coerce.pickText", () => {
    it("从容器键取值并 String 化；缺失 / null → null", () => {
        assert.equal(Coerce.pickText({ name: "x" }, "name"), "x");
        assert.equal(Coerce.pickText({ name: "" }, "name"), "");
        assert.equal(Coerce.pickText({ name: 42 }, "name"), "42");
        assert.equal(Coerce.pickText({ name: null }, "name"), null);
        assert.equal(Coerce.pickText({}, "name"), null);
    });

    it("容器不是普通对象（null / 数组 / 原始值）→ null", () => {
        assert.equal(Coerce.pickText(null, "name"), null);
        assert.equal(Coerce.pickText(undefined, "name"), null);
        assert.equal(Coerce.pickText([1], "0"), null);
        assert.equal(Coerce.pickText("text", "0"), null);
    });
});
