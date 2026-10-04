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

  it("T-TS-09: fs / ls + path → `ls /foo`（卡片给出具体 action）", () => {
    assert.equal(
      summarizeToolInput("fs", { action: "ls", path: "/foo" }),
      "ls /foo"
    );
  });

  it("T-TS-10: fs / ls 省略 path（列根目录）→ `ls /`", () => {
    assert.equal(summarizeToolInput("fs", { action: "ls" }), "ls /");
  });

  it("T-TS-11: fs / mkdir + path → `mkdir /foo`", () => {
    assert.equal(
      summarizeToolInput("fs", { action: "mkdir", path: "/foo" }),
      "mkdir /foo"
    );
  });

  it("T-TS-12: fs / mv + from/to → `mv /a.md → /b.md`（cp 同形）", () => {
    assert.equal(
      summarizeToolInput("fs", { action: "mv", from: "/a.md", to: "/b.md" }),
      "mv /a.md → /b.md"
    );
    assert.equal(
      summarizeToolInput("fs", { action: "cp", from: "/a.md", to: "/dir" }),
      "cp /a.md → /dir"
    );
  });

  it("T-TS-13: fs / cp 缺 to → 展示已有部分 `cp /a.md`（不全则不造箭头）", () => {
    assert.equal(
      summarizeToolInput("fs", { action: "cp", from: "/a.md" }),
      "cp /a.md"
    );
  });

  it("T-TS-14: fs / action 与 path 全缺 → 回落公共尾巴（JSON 兜底）", () => {
    assert.equal(
      summarizeToolInput("fs", { recursive: true }),
      '{"recursive":true}'
    );
  });

  it("T-TS-15: agent / get + name → `get general`（卡片给出具体 action 与目标）", () => {
    assert.equal(
      summarizeToolInput("agent", { action: "get", name: "general" }),
      "get general"
    );
  });

  it("T-TS-16: agent / list 无目标 → 裸 `list`", () => {
    assert.equal(summarizeToolInput("agent", { action: "list" }), "list");
  });

  it("T-TS-17: agent / create 的名字从 definition.name 取 → `create 写作助手`", () => {
    assert.equal(
      summarizeToolInput("agent", {
        action: "create",
        definition: {
          name: "写作助手",
          mode: "primary",
          prompts: { system: "…" },
        },
      }),
      "create 写作助手"
    );
  });

  it("T-TS-18: agent / update 名字取值 name > definition.name > id:agentId", () => {
    // name 显式给出：优先（definition.name 是 patch 旧名时也不干扰）
    assert.equal(
      summarizeToolInput("agent", {
        action: "update",
        name: "general",
        definition: { name: "旧名" },
      }),
      "update general"
    );
    // name 缺、definition.name 有：从定义体取
    assert.equal(
      summarizeToolInput("agent", {
        action: "update",
        definition: { name: "改后的名" },
      }),
      "update 改后的名"
    );
    // 两者都缺：退 agentId
    assert.equal(
      summarizeToolInput("agent", { action: "update", agentId: "agent-123" }),
      "update id:agent-123"
    );
  });

  it("T-TS-19: agent / action 缺失 → 回落公共尾巴（JSON 兜底）", () => {
    assert.equal(
      summarizeToolInput("agent", { name: "general" }),
      '{"name":"general"}'
    );
  });
});