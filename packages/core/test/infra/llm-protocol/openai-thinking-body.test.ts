import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { applyOpenAiThinkingToBody } from "../../../src/infra/llm-protocol/logic/apply-thinking-to-body.js";
import { OpenAiProtocolAdapter } from "../../../src/infra/llm-protocol/impl/openai.adapter.js";

describe("OpenAI thinking body", () => {
  it("applyOpenAiThinkingToBody 写入 reasoning_effort", () => {
    const body: Record<string, unknown> = { model: "gpt-4o" };
    applyOpenAiThinkingToBody(body, {
      protocol: "openai",
      openai: { reasoning_effort: "high" },
    });
    assert.equal(body.reasoning_effort, "high");
  });

  it("未传 thinking 时不写入字段", () => {
    const body: Record<string, unknown> = { model: "gpt-4o" };
    applyOpenAiThinkingToBody(body, undefined, "gpt-4o");
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.thinking, undefined);
  });

  it("GLM-4.7 未传 thinking 时显式关闭", () => {
    const body: Record<string, unknown> = { model: "glm-4.7" };
    applyOpenAiThinkingToBody(body, undefined, "glm-4.7");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.enable_thinking, false);
    assert.equal(body.reasoning_effort, undefined);
  });

  it("GLM-4.7 thinking 开启时写入 enabled 与 reasoning_effort", () => {
    const body: Record<string, unknown> = { model: "glm-4.7" };
    applyOpenAiThinkingToBody(
      body,
      { protocol: "openai", openai: { reasoning_effort: "medium" } },
      "glm-4.7",
    );
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.enable_thinking, true);
    assert.equal(body.reasoning_effort, "medium");
  });

  it("协议不匹配时不写入字段", () => {
    const body: Record<string, unknown> = { model: "gpt-4o" };
    applyOpenAiThinkingToBody(
      body,
      {
        protocol: "anthropic",
        anthropic: { type: "enabled", budget_tokens: 1000 },
      },
      "gpt-4o",
    );
    assert.equal(body.reasoning_effort, undefined);
  });

  it("adapter chat body 含 reasoning_effort", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      vendorModelId: "gpt-4o",
      userContent: "hi",
      thinking: {
        protocol: "openai",
        openai: { reasoning_effort: "medium" },
      },
    });

    assert.equal(captured.reasoning_effort, "medium");
  });

  it("thinking 开启时禁用 text-only shortcut 并写入 reasoning_effort", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      vendorModelId: "gpt-4o",
      userContent: "hi",
      thinking: {
        protocol: "openai",
        openai: { reasoning_effort: "low" },
      },
    });

    assert.equal(captured.reasoning_effort, "low");
    const messages = captured.messages as unknown[];
    assert.ok(Array.isArray(messages));
    assert.ok(messages.length >= 1);
  });
});
