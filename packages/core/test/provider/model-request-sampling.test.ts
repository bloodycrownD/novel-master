import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { OpenAiProtocolAdapter } from "../../src/infra/llm-protocol/impl/openai.adapter.js";
import { AnthropicProtocolAdapter } from "../../src/infra/llm-protocol/impl/anthropic.adapter.js";

describe("adapter sampling", () => {
  it("T9: OpenAI sampling merged into request body", async () => {
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
      vendorModelId: "gpt-4",
      userContent: "hi",
      system: "sys",
      sampling: {
        protocol: "openai",
        openai: { temperature: 0.5, top_p: 0.9 },
      },
    });

    assert.equal(captured.temperature, 0.5);
    assert.equal(captured.top_p, 0.9);
  });

  it("T10: Anthropic top_k in body", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      vendorModelId: "claude",
      userContent: "hi",
      sampling: {
        protocol: "anthropic",
        anthropic: { top_k: 40 },
      },
    });

    assert.equal(captured.top_k, 40);
  });
});
