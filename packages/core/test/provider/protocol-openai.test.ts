import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/errors/provider-errors.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
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

  it("chat rejects history with image blocks", async () => {
    const adapter = new OpenAiProtocolAdapter();
    const history: ChatMessage[] = [
      {
        id: "m1",
        sessionId: "s1",
        seq: 1,
        role: "user",
        content: {
          blocks: [
            {
              type: "image",
              source: { kind: "url", url: "https://example.com/a.png" },
            },
          ],
        },
        provider: null,
        raw: null,
        createdAtMs: 0,
        hidden: false,
      },
    ];

    await assert.rejects(
      () =>
        adapter.chat({
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-test",
          vendorModelId: "gpt-4o",
          userContent: "hello",
          history,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "UNSUPPORTED_CONTENT");
        return true;
      },
    );
  });
});
