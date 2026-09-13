import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleSmartSortRuleMatch } from "../../src/main/ipc/handlers/smart-sort-rule.js";

/**
 * nm:sort-rule/match handler 级测试（dtcli/G-1 桌面行为测试）：
 * handler 直调 core 纯函数 matchSmartSortPattern，这里锁的是 DTO 透传契约——
 * match 的 index（原文偏移，供高亮切分消费）/tuple 展示字段原样到达 renderer，
 * 以及「非法正则是合法测试结局」：ok:false 内联在结果里，不作 IPC 错误。
 */
describe("nm:sort-rule/match handler", () => {
  it("透传 match 的 index/text/groups/tuple（smart 档数字元组）", async () => {
    const text = "序言 第1章 中段 第2章 结尾";
    const res = await handleSmartSortRuleMatch({
      pattern: "第(\\d+)章",
      flags: "i",
      text,
      captureKind: "smart",
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.equal(res.data.ok, true);
    if (!res.data.ok) {
      return;
    }
    assert.equal(res.data.matches.length, 2);
    const [first, second] = res.data.matches;
    // index 是原文起始偏移（matchAll 原生 index），高亮切分直接消费
    assert.equal(first.text, "第1章");
    assert.equal(first.index, text.indexOf("第1章"));
    assert.deepEqual(first.groups, ["1"]);
    assert.equal(first.tuple, "(1,)");
    assert.equal(second.text, "第2章");
    assert.equal(second.index, text.lastIndexOf("第2章"));
    assert.deepEqual(second.groups, ["2"]);
    assert.equal(second.tuple, "(2,)");
  });

  it("重复匹配文本的 index 各自独立（indexOf 回查会漂，偏移透传不漂）", async () => {
    const text = "第1章 开头 第1章 结尾";
    const res = await handleSmartSortRuleMatch({
      pattern: "第(\\d+)章",
      flags: "",
      text,
      captureKind: "smart",
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.equal(res.data.ok, true);
    if (!res.data.ok) {
      return;
    }
    const [first, second] = res.data.matches;
    assert.equal(first.index, text.indexOf("第1章"));
    assert.equal(second.index, text.lastIndexOf("第1章"));
    assert.notEqual(first.index, second.index);
  });

  it("fixed 档 tuple 为哨兵文案（忽略捕获组）", async () => {
    const res = await handleSmartSortRuleMatch({
      pattern: "第(\\d+)章",
      flags: "",
      text: "第3章",
      captureKind: "fixed_min",
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.equal(res.data.ok, true);
    if (!res.data.ok) {
      return;
    }
    assert.equal(res.data.matches.length, 1);
    // 捕获组照常透传，tuple 恒为固定档哨兵（D13）
    assert.deepEqual(res.data.matches[0].groups, ["3"]);
    assert.equal(res.data.matches[0].tuple, "(固定最小,)");
  });

  it("非法正则返回 ok:false 的测试结果（非 IPC 错误）", async () => {
    const res = await handleSmartSortRuleMatch({
      pattern: "([未闭合",
      flags: "",
      text: "任意文本",
      captureKind: "smart",
    });
    // 外层 IPC ok：非法正则是合法测试结局，错误内联在结果里
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.equal(res.data.ok, false);
    if (res.data.ok) {
      return;
    }
    assert.equal(typeof res.data.error, "string");
    assert.ok(res.data.error.length > 0);
  });
});
