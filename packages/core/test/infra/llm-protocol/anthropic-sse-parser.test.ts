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
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"vfs.read"}}',
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
});
