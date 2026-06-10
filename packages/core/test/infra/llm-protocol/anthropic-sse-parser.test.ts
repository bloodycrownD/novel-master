import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAnthropicSseParserState,
  feedAnthropicSseChunk,
  finishAnthropicSse,
} from "../../../src/infra/llm-protocol/logic/anthropic-sse-parser.js";

describe("anthropic-sse-parser", () => {
  it("T3: incremental text, thinking, and tool_use", () => {
    const state = createAnthropicSseParserState();
    const deltas: string[] = [];
    const onStream = (ev: { type: string; text?: string }) => {
      if (ev.type === "text-delta" && ev.text != null) {
        deltas.push(ev.text);
      }
    };

    feedAnthropicSseChunk(
      state,
      [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"think"}}',
        "",
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"read"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"/a\\"}"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
      ].join("\n"),
      onStream,
    );

    const { blocks } = finishAnthropicSse(state, onStream);
    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(blocks.filter((b) => b.type === "text").length, 1);
    assert.equal(blocks.filter((b) => b.type === "thinking").length, 1);
    assert.equal(blocks.filter((b) => b.type === "tool_use").length, 1);
  });

  it("accumulates signature_delta fragments into thinkingSignature", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      [
        'data: {"type":"content_block_start","content_block":{"type":"thinking","thinking":""}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"plan"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"sig"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"-part2"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
      ].join("\n"),
    );
    const { blocks } = finishAnthropicSse(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "plan");
      assert.equal(blocks[0].thinkingSignature, "sig-part2");
    }
  });

  it("preserves block order: thinking before tool_use", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      [
        'data: {"type":"content_block_start","content_block":{"type":"thinking","thinking":""}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"t"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"read"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
      ].join("\n"),
    );
    const { blocks } = finishAnthropicSse(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "thinking");
    assert.equal(blocks[1]?.type, "tool_use");
  });

  it("parses redacted_thinking content block", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      [
        'data: {"type":"content_block_start","content_block":{"type":"redacted_thinking","data":"blob"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
      ].join("\n"),
    );
    const { blocks } = finishAnthropicSse(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "redacted_thinking");
    if (blocks[0]?.type === "redacted_thinking") {
      assert.equal(blocks[0].data, "blob");
    }
  });
});
