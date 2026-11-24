import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  Json  } from "../../src/common/json.js";

describe("common/json · Json.parseText", () => {
    it("剥 UTF-8 BOM 后解析", () => {
        const result = Json.parseText(`\uFEFF{"a":1}`);
        assert.equal(result.ok, true);
        if (!result.ok) {
            return;
        }
        assert.deepEqual(result.value, { a: 1 });
    });

    it("非法 JSON 返回 Err 而不是抛异常", () => {
        const result = Json.parseText("{");
        assert.equal(result.ok, false);
    });
});

describe("common/json · Json.prettyJson", () => {
    it("对象 / 数组加两空格缩进，空容器留在同一行", () => {
        assert.equal(Json.prettyJson('{"a":1,"b":[1,2],"c":{},"d":[]}', 300), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": {},\n  "d": []\n}');
    });

    it("超出安全整数范围的数字与短字符串逐字节保留", () => {
        const big = "1798274923044444160";
        assert.equal(Json.prettyJson(`{"id":${big},"s":"a,b:c{}[]"}`, 300), `{\n  "id": ${big},\n  "s": "a,b:c{}[]"\n}`);
    });

    it("不是 JSON 对象 / 数组时返回 null（标量、非法文本）", () => {
        assert.equal(Json.prettyJson("123", 300), null);
        assert.equal(Json.prettyJson("null", 300), null);
        assert.equal(Json.prettyJson("{color:red}", 300), null);
        assert.equal(Json.prettyJson("plain text", 300), null);
    });

    it("超过宽度的字符串值解码后展开：内嵌 JSON 递归缩进，普通文本按行输出", () => {
        const out = Json.prettyJson(`{"r":"[{\\"t\\":\\"x\\"}]","n":"line1\\nline2"}`, 10);
        assert.equal(out, `{
  "r": "[
  {
    "t": "x"
  }
]",
  "n": "line1
line2"
}`);
    });

    it("超过宽度的普通长字符串值按宽度折行", () => {
        const out = Json.prettyJson(`{"s":"${"ab ".repeat(10)}"}`, 10);
        assert.equal(out, `{\n  "s": "ab ab ab\nab ab ab\nab ab ab\nab "\n}`);
    });
});

describe("common/json · Json.mergePatch", () => {
    it("深层合并对象，未出现的键保留现值", () => {
        const current = { name: "a", runtime: { maxSteps: 3, threshold: 2 }, prompts: { persist: [] } };
        const merged = Json.mergePatch(current, { runtime: { maxSteps: 9 } });
        assert.deepEqual(merged.runtime, { maxSteps: 9, threshold: 2 });
        assert.equal(merged.name, "a");
        assert.deepEqual(merged.prompts, { persist: [] });
    });

    it("null 删除键（回到缺省）", () => {
        const merged = Json.mergePatch({ name: "a", model: "m1", runtime: { maxSteps: 3 } }, { model: null, runtime: null });
        assert.deepEqual(merged, { name: "a" });
    });

    it("数组整体替换，不做元素级合并", () => {
        const merged = Json.mergePatch({ tools: { allow: ["a", "b"], deny: ["c"] } }, { tools: { allow: ["d"] } });
        assert.deepEqual(merged.tools, { allow: ["d"], deny: ["c"] });
    });

    it("标量整体替换", () => {
        assert.equal(Json.mergePatch({ flag: true }, { flag: false }).flag, false);
        assert.equal(Json.mergePatch("old", "new"), "new");
    });

    it("空 patch 返回等价副本且不修改原对象", () => {
        const current = { a: { b: 1 } };
        const merged = Json.mergePatch(current, {});
        assert.deepEqual(merged, current);
        assert.notEqual(merged, current);
        assert.deepEqual(current, { a: { b: 1 } });
    });

    it("current 不是对象时以空对象为基底", () => {
        assert.deepEqual(Json.mergePatch(null, { a: 1 }), { a: 1 });
        assert.deepEqual(Json.mergePatch(42, { a: 1 }), { a: 1 });
    });

    it("undefined 值视为未提供，保留现值", () => {
        const merged = Json.mergePatch({ a: 1, b: 2 }, { a: undefined });
        assert.deepEqual(merged, { a: 1, b: 2 });
    });

    it("忽略原型污染键", () => {
        const patch = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as Record<string, unknown>;
        const merged = Json.mergePatch({ base: true }, patch) as Record<string, unknown>;
        assert.equal(merged.ok, 1);
        assert.equal(merged.base, true);
        assert.equal(({} as { polluted?: boolean }).polluted, undefined);
        assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    });
});
