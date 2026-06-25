import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { applyGeminiThinkingToBody } from "../../../src/infra/llm-protocol/logic/apply-thinking-to-body.js";
import { GeminiProtocolAdapter } from "../../../src/infra/llm-protocol/impl/gemini.adapter.js";

describe("Gemini thinking body", () => {
  it("applyGeminiThinkingToBody 写入 thinkingConfig", () => {
    const body: Record<string, unknown> = {};
    applyGeminiThinkingToBody(body, {
      protocol: "gemini",
      gemini: { thinkingConfig: { thinkingBudget: -1 } },
    });
    assert.deepEqual(body.generationConfig, {
      thinkingConfig: { thinkingBudget: -1 },
    });
  });

  it("与已有 generationConfig 合并", () => {
    const body: Record<string, unknown> = {
      generationConfig: { temperature: 0.7 },
    };
    applyGeminiThinkingToBody(body, {
      protocol: "gemini",
      gemini: { thinkingConfig: { thinkingLevel: "medium" } },
    });
    assert.deepEqual(body.generationConfig, {
      temperature: 0.7,
      thinkingConfig: { thinkingLevel: "medium" },
    });
  });

  it("未传 thinking 时不写入字段", () => {
    const body: Record<string, unknown> = {};
    applyGeminiThinkingToBody(body, undefined);
    assert.equal(body.generationConfig, undefined);
  });

  it("adapter chat body 含 thinkingConfig", async () => {
    let captured: Record<string, unknown> = {};
    const fetchFn = mock.fn(async (_url, init) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    await adapter.chat({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "k",
      vendorModelId: "gemini-2.5-flash",
      userContent: "hi",
      thinking: {
        protocol: "gemini",
        gemini: { thinkingConfig: { thinkingBudget: -1 } },
      },
    });

    const generationConfig = captured.generationConfig as {
      thinkingConfig?: { thinkingBudget?: number };
    };
    assert.deepEqual(generationConfig.thinkingConfig, { thinkingBudget: -1 });
  });
});
