import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { AnthropicProtocolAdapter } from "../../src/infra/llm-protocol/anthropic.adapter.js";

describe("AnthropicProtocolAdapter HTTP", () => {
  it("listModels uses GET /v1/models with anthropic headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({ data: [{ id: "claude-3-5-sonnet", display_name: "Sonnet" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.listModels({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.anthropic.com/v1/models");
    assert.equal(calls[0]!.init.method, "GET");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-ant-test");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(result.models[0]?.vendorModelId, "claude-3-5-sonnet");
  });

  it("chat uses POST /v1/messages", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.anthropic.com/",
      apiKey: "key",
      vendorModelId: "claude-3-5-sonnet",
      userContent: "hello",
    });

    assert.equal(calls[0]!.url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(result.assistantText, "hi");
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0]!.type, "text");
  });
});
