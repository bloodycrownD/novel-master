import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AnthropicProtocolAdapter } from "../../../src/infra/llm-protocol/impl/anthropic.adapter.js";
import {
  createAnthropicSseParserState,
  feedAnthropicSseChunk,
  finishAnthropicSsePartial,
} from "../../../src/infra/llm-protocol/logic/anthropic-sse-parser.js";

describe("anthropic partial stream", () => {
  it("finishAnthropicSsePartial: only thinking → thinking only", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"partial"}}\n',
    );
    const { blocks } = finishAnthropicSsePartial(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "partial");
    }
  });

  it("T4: abort mid-stream returns partial blocks via adapter", async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Par"}}',
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

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "key",
      vendorModelId: "claude",
      userContent: "hi",
      stream: true,
      signal: controller.signal,
    });

    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0]?.type, "text");
    if (result.blocks[0]?.type === "text") {
      assert.equal(result.blocks[0].text, "Par");
    }
  });
});
