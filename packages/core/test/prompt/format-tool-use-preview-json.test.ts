import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatToolUsePreviewJson } from "@novel-master/core/prompt";

describe("formatToolUsePreviewJson（tool use 格子预览：保结构截大 key）", () => {
  it("超长字符串值截断、顶层 key 结构保留", () => {
    const input = JSON.stringify({
      path: "a.md",
      content: "x".repeat(500),
    });
    const out = formatToolUsePreviewJson(input);
    const parsed = JSON.parse(out) as { path: string; content: string };
    assert.equal(parsed.path, "a.md");
    assert.match(parsed.content, /x{10,}/);
    assert.match(parsed.content, /（截断，全文 500 字）/);
  });

  it("超长数组截项：前 6 项 + 「另有 N 项」", () => {
    const input = JSON.stringify({
      items: Array.from({ length: 10 }, (_, i) => `item-${i}`),
    });
    const out = formatToolUsePreviewJson(input);
    const parsed = JSON.parse(out) as { items: string[] };
    assert.equal(parsed.items.length, 7);
    assert.equal(parsed.items[0], "item-0");
    assert.equal(parsed.items[6], "…另有 4 项");
  });

  it("浅层不收缩：小对象原样 pretty", () => {
    const input = JSON.stringify({ path: "a.md", limit: 10 });
    assert.equal(
      formatToolUsePreviewJson(input),
      '{\n  "path": "a.md",\n  "limit": 10\n}',
    );
  });

  it("退化单行与 parse 失败原样返回（CLI 形态兜底）", () => {
    assert.equal(
      formatToolUsePreviewJson("[tool_use name=read id=u1]"),
      "[tool_use name=read id=u1]",
    );
    assert.equal(formatToolUsePreviewJson("not json"), "not json");
  });

  it("超深嵌套折叠为 …（第 4 层起，数组与对象同受护栏）", () => {
    const deep = { a: { b: { c: { d: { e: "x".repeat(300) } } } } };
    const out = formatToolUsePreviewJson(JSON.stringify(deep));
    const parsed = JSON.parse(out) as Record<string, unknown>;
    const a = parsed.a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    const c = b.c as Record<string, unknown>;
    assert.equal(c.d, "…");
    // 纯数组深嵌套不再绕过深度护栏（此前只挡对象，深数组在 stringify 侧
    // 就有爆栈风险；60 层已远超护栏且构造安全）。
    let deepArray: unknown = ["leaf"];
    for (let i = 0; i < 60; i++) {
      deepArray = [deepArray];
    }
    const arrayOut = formatToolUsePreviewJson(JSON.stringify(deepArray));
    assert.match(arrayOut, /…/);
    assert.ok(arrayOut.length < 200, `深数组应折叠而非原样回吐（${arrayOut.length} 字）`);
  });

  it("宽对象截 key：前 40 个字段 + 「…另有 N 个字段」占位", () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      wide[`key_${i}`] = `v${i}`;
    }
    const out = formatToolUsePreviewJson(JSON.stringify({ wide }));
    const parsed = JSON.parse(out) as { wide: Record<string, unknown> };
    const keys = Object.keys(parsed.wide);
    assert.equal(keys.length, 41);
    assert.equal(keys[0], "key_0");
    assert.equal(keys[40], "…另有 10 个字段");
  });
});
