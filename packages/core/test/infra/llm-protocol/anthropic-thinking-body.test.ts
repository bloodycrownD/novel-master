import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  applyAnthropicThinkingToBody,
} from "../../../src/infra/llm-protocol/logic/apply-thinking-to-body.js";
import { AnthropicProtocolAdapter } from "../../../src/infra/llm-protocol/impl/anthropic.adapter.js";

describe("Anthropic thinking body", () => {
  it("applyAnthropicThinkingToBody 写入 thinking 字段", () => {
    const body: Record<string, unknown> = { model: "claude" };
    applyAnthropicThinkingToBody(body, {
      protocol: "anthropic",
      anthropic: { type: "enabled", budget_tokens: 8000 },
    });
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 8000 });
  });

  it("未传 thinking 时不写入字段", () => {
    const body: Record<string, unknown> = { model: "claude" };
    applyAnthropicThinkingToBody(body, undefined);
    assert.equal(body.thinking, undefined);
  });

  it("协议不匹配时不写入字段", () => {
    const body: Record<string, unknown> = { model: "claude" };
    applyAnthropicThinkingToBody(body, {
      protocol: "openai",
      openai: { reasoning_effort: "medium" },
    });
    assert.equal(body.thinking, undefined);
  });

  it("adapter chat body 含 thinking", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      vendorModelId: "claude-3-5-sonnet",
      userContent: "hi",
      thinking: {
        protocol: "anthropic",
        anthropic: { type: "enabled", budget_tokens: 4095 },
      },
    });

    assert.deepEqual(captured.thinking, { type: "enabled", budget_tokens: 4095 });
  });
});
