import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { OpenAiProtocolAdapter } from "../../src/infra/llm-protocol/openai.adapter.js";

describe("OpenAiProtocolAdapter HTTP", () => {
  it("listModels uses GET /models with bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = mock.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({ data: [{ id: "gpt-4o" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new OpenAiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.listModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });

    assert.equal(calls[0]!.url, "https://api.openai.com/v1/models");
    assert.equal(calls[0]!.init.method, "GET");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-test");
    assert.equal(result.models[0]?.vendorModelId, "gpt-4o");
  });
});
