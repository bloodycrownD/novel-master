import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMergePatch } from "../../src/common/merge-patch.js";

describe("applyMergePatch", () => {
  it("深层合并对象，未出现的键保留现值", () => {
    const current = { name: "a", runtime: { maxSteps: 3, threshold: 2 }, prompts: { persist: [] } };
    const merged = applyMergePatch(current, { runtime: { maxSteps: 9 } });
    assert.deepEqual(merged.runtime, { maxSteps: 9, threshold: 2 });
    assert.equal(merged.name, "a");
    assert.deepEqual(merged.prompts, { persist: [] });
  });

  it("null 删除键（回到缺省）", () => {
    const merged = applyMergePatch({ name: "a", model: "m1", runtime: { maxSteps: 3 } }, { model: null, runtime: null });
    assert.deepEqual(merged, { name: "a" });
  });

  it("数组整体替换，不做元素级合并", () => {
    const merged = applyMergePatch({ tools: { allow: ["a", "b"], deny: ["c"] } }, { tools: { allow: ["d"] } });
    assert.deepEqual(merged.tools, { allow: ["d"], deny: ["c"] });
  });

  it("标量整体替换", () => {
    assert.equal(applyMergePatch({ flag: true }, { flag: false }).flag, false);
    assert.equal(applyMergePatch("old", "new"), "new");
  });

  it("空 patch 返回等价副本且不修改原对象", () => {
    const current = { a: { b: 1 } };
    const merged = applyMergePatch(current, {});
    assert.deepEqual(merged, current);
    assert.notEqual(merged, current);
    assert.deepEqual(current, { a: { b: 1 } });
  });

  it("current 不是对象时以空对象为基底", () => {
    assert.deepEqual(applyMergePatch(null, { a: 1 }), { a: 1 });
    assert.deepEqual(applyMergePatch(42, { a: 1 }), { a: 1 });
  });

  it("undefined 值视为未提供，保留现值", () => {
    const merged = applyMergePatch({ a: 1, b: 2 }, { a: undefined });
    assert.deepEqual(merged, { a: 1, b: 2 });
  });

  it("忽略原型污染键", () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as Record<string, unknown>;
    const merged = applyMergePatch({ base: true }, patch) as Record<string, unknown>;
    assert.equal(merged.ok, 1);
    assert.equal(merged.base, true);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  });
});
