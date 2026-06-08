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

  it("T8: chat with tools includes functionDeclarations in body", async () => {
    const calls: Array<{ body: string }> = [];
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: "read", args: { path: "/a" } },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
      vendorModelId: "gemini-2.0-flash",
      userContent: "hi",
      tools: [
        {
          name: "read",
          description: "read",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });

    const parsed = JSON.parse(calls[0]!.body) as {
      tools?: Array<{ functionDeclarations?: unknown[] }>;
    };
    assert.ok(Array.isArray(parsed.tools));
    assert.ok(parsed.tools![0]!.functionDeclarations!.length >= 1);
    assert.equal(result.blocks[0]?.type, "tool_use");
  });

  it("stream uses streamGenerateContent with alt=sse", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchFn = mock.fn(async (url: string) => {
      calls.push({ url });
      const sse = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}]}',
        "",
      ].join("\n");
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const adapter = new GeminiProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
      vendorModelId: "gemini-2.0-flash",
      userContent: "hi",
      stream: true,
    });

    assert.match(calls[0]!.url, /streamGenerateContent/);
    assert.match(calls[0]!.url, /alt=sse/);
    assert.equal(result.assistantText, "Hi");
  });
});
