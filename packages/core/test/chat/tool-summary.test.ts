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

  it("T-TS-20: curl / 只给 url → method 缺省补 `GET`（schema 默认值）", () => {
    assert.equal(
      summarizeToolInput("curl", { url: "https://example.com/a" }),
      "GET https://example.com/a"
    );
  });

  it("T-TS-21: curl / 带 method → `METHOD url`（body/headers/timeout 不进摘要）", () => {
    assert.equal(
      summarizeToolInput("curl", {
        url: "https://example.com/api",
        method: "POST",
        headers: { Authorization: "Bearer x" },
        body: { a: 1 },
        timeout: 30,
      }),
      "POST https://example.com/api"
    );
  });

  it("T-TS-22: curl / method 小写 → 大写化（与工具结果首行同口径）", () => {
    assert.equal(
      summarizeToolInput("curl", { url: "https://example.com", method: "put" }),
      "PUT https://example.com"
    );
  });

  it("T-TS-23: curl / url 缺失或空串 → 回落公共尾巴（JSON 兜底 / path 取值）", () => {
    assert.equal(
      summarizeToolInput("curl", { method: "POST", timeout: 10 }),
      '{"method":"POST","timeout":10}'
    );
    // 空串 url 视为未给（curl 的 url schema 是 min(1)），交回公共尾巴：
    // 公共尾巴有 path 语义就取 path，没有就 JSON 兜底。
    assert.equal(summarizeToolInput("curl", { url: "", dir: "/tmp" }), "/tmp");
    assert.equal(summarizeToolInput("curl", { url: "" }), '{"url":""}');
  });

  it("T-TS-24: curl / url 超长 → 120 口径截断（总长 ≤ 118 且以 `…` 结尾）", () => {
    const summary = summarizeToolInput("curl", {
      url: `https://example.com/${"x".repeat(400)}`,
    });
    assert.ok(summary.length <= 118, `实际长度 ${summary.length}`);
    assert.ok(summary.endsWith("…"));
    assert.ok(summary.startsWith("GET https://example.com/"));
  });

  it("T-TS-25: search / 只给 query → query 本身（maxResults 不进摘要）", () => {
    assert.equal(
      summarizeToolInput("search", { query: "novel master", maxResults: 8 }),
      "novel master"
    );
  });

  it("T-TS-26: search / 带 engine → `query · engine`（engine 缺省不拼）", () => {
    assert.equal(
      summarizeToolInput("search", { query: "小说大纲", engine: "bocha" }),
      "小说大纲 · bocha"
    );
    assert.equal(
      summarizeToolInput("search", { query: "小说大纲", engine: "" }),
      "小说大纲"
    );
  });

  it("T-TS-27: search / query 缺失或空串 → 回落公共尾巴（JSON 兜底）", () => {
    assert.equal(
      summarizeToolInput("search", { maxResults: 3 }),
      '{"maxResults":3}'
    );
    assert.equal(summarizeToolInput("search", { query: "" }), '{"query":""}');
  });

  it("T-TS-28: search / query 超长 → 120 口径截断（保留 query 开头，不带 JSON 括号）", () => {
    const summary = summarizeToolInput("search", {
      query: "词".repeat(300),
      engine: "bocha",
    });
    assert.ok(summary.length <= 118, `实际长度 ${summary.length}`);
    assert.ok(summary.endsWith("…"));
    // 变异自证：拿掉 search 分支时会退化成 `{"query":"词…"}`，开头不是「词」。
    assert.ok(summary.startsWith("词"), `实际开头 ${summary.slice(0, 12)}`);
  });
});