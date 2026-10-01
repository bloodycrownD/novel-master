import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeToolInput } from "../../src/domain/chat/logic/tool-summary.js";

describe("summarizeToolInput（core 单源）", () => {
  it("T-TS-01: skill / read + domain=global → `read global:my-skill`", () => {
    assert.equal(
      summarizeToolInput("skill", { action: "read", name: "my-skill", domain: "global" }),
      "read global:my-skill"
    );
  });

  it("T-TS-02: skill / write + 无 domain → `write my-skill`", () => {
    assert.equal(
      summarizeToolInput("skill", { action: "write", name: "my-skill" }),
      "write my-skill"
    );
  });

  it("T-TS-03: task → `@agent · description`（description 已 trim）", () => {
    assert.equal(
      summarizeToolInput("task", {
        subagentName: "researcher",
        description: " 调研章节大纲 ",
      }),
      "@researcher · 调研章节大纲"
    );
  });

  it("T-TS-04: task 只给 description → 退化为 description 本身（无前导 ` · `）", () => {
    assert.equal(
      summarizeToolInput("task", { description: "调研章节大纲" }),
      "调研章节大纲"
    );
  });

  it("T-TS-05: path 优先；空对象/null → 空串", () => {
    assert.equal(summarizeToolInput("read", { path: "a.md" }), "a.md");
    assert.equal(summarizeToolInput("read", {}), "");
    assert.equal(summarizeToolInput("read", null), "");
    assert.equal(summarizeToolInput("read", undefined), "");
  });

  it("T-TS-06: 超长 input 长度 ≤ 118 且以 `…` 结尾（守住 120 截断契约）", () => {
    const summary = summarizeToolInput("custom", { blob: "x".repeat(400) });
    assert.ok(summary.length <= 118, `实际长度 ${summary.length}`);
    assert.ok(summary.endsWith("…"));
  });

  it("T-TS-07: 空串 path 的回落语义 = 直接返回空串（`??` 只判 null/undefined）", () => {
    // ⚠️ 本条钉住单源选定的 `??` 语义：按 WebView 旧副本的 `||` 实现，这一条会红
    //（`||` 把空串当 falsy ⇒ 回落到 dir ⇒ 得到 "x.md"）。
    assert.equal(summarizeToolInput("read", { path: "", dir: "x.md" }), "");
    // 对照：path 缺失时才回落 dir。
    assert.equal(summarizeToolInput("read", { dir: "x.md" }), "x.md");
  });

  it("T-TS-08: dir / from 依次回落（公共尾巴不回归）", () => {
    assert.equal(summarizeToolInput("read", { from: "z.md" }), "z.md");
  });
});