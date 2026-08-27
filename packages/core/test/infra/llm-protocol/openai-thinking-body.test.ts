import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { applyOpenAiThinkingToBody } from "../../../src/infra/llm-protocol/logic/apply-thinking-to-body.js";
import { OpenAiProtocolAdapter } from "../../../src/infra/llm-protocol/impl/openai.adapter.js";

function jsonResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "ok" } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OpenAI thinking body", () => {
  it("applyOpenAiThinkingToBody 写入 reasoning_effort", () => {
    const body: Record<string, unknown> = { model: "gpt-4o" };
    applyOpenAiThinkingToBody(body, {
      protocol: "openai",
      openai: { reasoning_effort: "high" },
    });
    assert.equal(body.reasoning_effort, "high");
    assert.equal("thinking" in body, false);
    assert.equal("enable_thinking" in body, false);
  });

  it("未传 thinking 时不写入字段", () => {
    const body: Record<string, unknown> = { model: "gpt-4o" };
    applyOpenAiThinkingToBody(body, undefined);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.thinking, undefined);
  });

  it("GLM 型号与 gpt-* 行为一致：仅写入 reasoning_effort", () => {
    for (const model of ["glm-4.7", "glm-5.2"]) {
      const body: Record<string, unknown> = { model };
      applyOpenAiThinkingToBody(body, {
        protocol: "openai",
        openai: { reasoning_effort: "medium" },
      });
      assert.equal(body.reasoning_effort, "medium");
      assert.equal("thinking" in body, false);
      assert.equal("enable_thinking" in body, false);
    }
  });

  it("GLM 型号未传 thinking 时不写入任何思考字段", () => {
    const body: Record<string, unknown> = { model: "glm-4.7" };
    applyOpenAiThinkingToBody(body, undefined);
    assert.equal("reasoning_effort" in body, false);
    assert.equal("thinking" in body, false);
    assert.equal("enable_thinking" in body, false);
  });

  it("协议不匹配时不写入字段", () => {
    const body: Record<string, unknown> = { model: "gpt-4o" };
    applyOpenAiThinkingToBody(body, {
      protocol: "anthropic",
      anthropic: { type: "enabled", budget_tokens: 1000 },
    });
    assert.equal(body.reasoning_effort, undefined);
  });

  it("adapter chat body 含 reasoning_effort", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse();
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
      return jsonResponse();
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

  it("GLM 型号走 adapter chat（buildBody）仅写入 reasoning_effort", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse();
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      apiKey: "k",
      vendorModelId: "glm-4.7",
      userContent: "hi",
      thinking: {
        protocol: "openai",
        openai: { reasoning_effort: "medium" },
      },
    });

    assert.equal(captured.reasoning_effort, "medium");
    assert.equal("thinking" in captured, false);
    assert.equal("enable_thinking" in captured, false);
  });

  it("GLM 型号走 text-only 路径未传 thinking 时不写入任何思考字段", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse();
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      apiKey: "k",
      vendorModelId: "glm-4.7",
      userContent: "hi",
    });

    assert.equal("reasoning_effort" in captured, false);
    assert.equal("thinking" in captured, false);
    assert.equal("enable_thinking" in captured, false);
  });
});
