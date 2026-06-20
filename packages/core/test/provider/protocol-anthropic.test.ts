import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { AnthropicProtocolAdapter } from "../../src/infra/llm-protocol/impl/anthropic.adapter.js";

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

  it("chat encodes dotted tool names for strict anthropic gateways", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "foo_bar",
              input: { path: "/a.txt" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "key",
      vendorModelId: "deepseek-v4-flash",
      userContent: "read file",
      tools: [
        {
          name: "foo.bar",
          description: "read",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      tools: Array<{ name: string }>;
    };
    assert.equal(body.tools[0]?.name, "foo_bar");
    assert.equal(result.blocks[0]?.type, "tool_use");
    if (result.blocks[0]?.type === "tool_use") {
      assert.equal(result.blocks[0].name, "foo.bar");
    }
  });

  it("P-ANT-01: stream tool_use emits tool-use at content_block_stop", async () => {
    const sse = [
      "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"tu_1\",\"name\":\"read\"}}",
      "",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\"}}",
      "",
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"/tmp\\\"}\"}}",
      "",
      "data: {\"type\":\"content_block_stop\"}",
      "",
    ].join("\n");

    const fetchFn = mock.fn(async () => {
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const toolUses: Array<{ input: Record<string, unknown> }> = [];
    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "key",
      vendorModelId: "claude-3-5-sonnet",
      userContent: "read",
      stream: true,
      tools: [{ name: "read", description: "d", inputSchema: {} }],
      onStream: (ev) => {
        if (ev.type === "tool-use") toolUses.push(ev);
      },
    });

    assert.equal(toolUses.length, 1);
    assert.equal(toolUses[0]!.input.path, "/tmp");
  });
});

