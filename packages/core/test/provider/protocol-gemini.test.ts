import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GeminiProtocolAdapter } from "../../src/infra/llm-protocol/impl/gemini.adapter.js";

describe("GeminiProtocolAdapter HTTP", () => {
  it("listModels uses GET /models with key query param", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-2.0-flash", displayName: "Flash" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.listModels({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/v1beta\/models\?key=gem-key$/);
    assert.equal(calls[0]!.init.method, "GET");
    assert.equal(result.models[0]?.vendorModelId, "gemini-2.0-flash");
  });

  it("chat uses POST generateContent with key in URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
      vendorModelId: "gemini-2.0-flash",
      userContent: "ping",
    });

    assert.equal(
      calls[0]!.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=gem-key",
    );
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(result.assistantText, "ok");
  });
});
