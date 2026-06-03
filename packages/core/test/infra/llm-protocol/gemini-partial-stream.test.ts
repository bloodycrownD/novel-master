import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { GeminiProtocolAdapter } from "../../../src/infra/llm-protocol/impl/gemini.adapter.js";

describe("gemini partial stream", () => {
  it("abort mid-stream returns partial text blocks", async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Par"}],"role":"model"}}]}',
      "",
    ].join("\n");

    const controller = new AbortController();
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal != null) {
        signal.addEventListener("abort", () => {
          controller.abort();
        });
      }
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(sse));
          controller.abort();
          streamController.close();
        },
      });
      return new Response(body, {
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
      signal: controller.signal,
    });

    assert.ok(
      result.blocks.some((b) => b.type === "text" && b.text === "Par"),
    );
  });
});
