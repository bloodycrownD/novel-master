import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  createAnthropicSseParserState,
  feedAnthropicSseChunk,
  finishAnthropicSse,
  finishAnthropicSsePartial,
} from "../../../src/infra/llm-protocol/logic/anthropic-sse-parser.js";
import { parseAnthropicUsage } from "../../../src/infra/llm-protocol/logic/usage-parser.js";

describe("anthropic-sse-parser", () => {
  it("T3: incremental text, thinking, and tool_use", () => {
    const state = createAnthropicSseParserState();
    const deltas: string[] = [];
    const toolUses: unknown[] = [];
    const onStream = (ev: {
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }) => {
      if (ev.type === "text-delta" && ev.text != null) {
        deltas.push(ev.text);
      }
      if (ev.type === "tool-use") {
        toolUses.push(ev);
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
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"\\"/a\\"}"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
      ].join("\n"),
      onStream,
    );

    const { blocks } = finishAnthropicSse(state, onStream);
    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(toolUses.length, 1);
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
  it("SSE-MAL-01: only malformed lines throw on finish", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(state, "data: {bad\n\n");
    assert.throws(
      () => finishAnthropicSse(state),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "MALFORMED_SSE");
        return true;
      },
    );
  });

  it("SSE-MAL-02: malformed line with valid text", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(state, "data: oops\n\n");
    feedAnthropicSseChunk(
      state,
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\n",
    );
    const { blocks } = finishAnthropicSse(state);
    assert.equal(state.malformedLineCount, 1);
    assert.equal(blocks.length, 1);
  });

  it("T-ITA-02 / TU-04: invalid partial_json on block stop degrades, no throw", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      [
        "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"read\"}}",
        "",
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{bad\"}}",
        "",
        "data: {\"type\":\"content_block_stop\"}",
        "",
      ].join("\n"),
    );
    const { blocks, degradedToolCalls } = finishAnthropicSse(state);
    assert.equal(degradedToolCalls.length, 1);
    assert.equal(degradedToolCalls[0]!.id, "t1");
    assert.equal(degradedToolCalls[0]!.reason, "INVALID_TOOL_ARGUMENTS");
    const toolUse = blocks.find((b) => b.type === "tool_use");
    assert.ok(toolUse && toolUse.type === "tool_use");
    assert.deepEqual(toolUse.input, {});
  });

  it("T-S2: message_start 输入侧 + message_delta 累计 output 合并后都在", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      [
        'data: {"type":"message_start","message":{"model":"claude-sonnet-4","usage":{"input_tokens":100,"cache_read_input_tokens":60,"cache_creation_input_tokens":30,"output_tokens":1}}}',
        "",
        'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":42}}',
        "",
      ].join("\n"),
    );
    const { streamRaw } = finishAnthropicSse(state);
    const usage = parseAnthropicUsage(streamRaw);
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.completionTokens, 42);
    assert.equal(usage?.totalTokens, 142);
    assert.equal(usage?.cacheReadTokens, 60);
    assert.equal(usage?.cacheCreationTokens, 30);
    const raw = streamRaw as Record<string, unknown>;
    assert.equal(raw.model, "claude-sonnet-4");
    assert.deepEqual(raw.delta, { stop_reason: "end_turn", stop_sequence: null });
  });

  it("T-S2: 只有 message_start 没有 message_delta（中途断流）时输入侧仍在", () => {
    const state = createAnthropicSseParserState();
    feedAnthropicSseChunk(
      state,
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4","usage":{"input_tokens":100,"cache_read_input_tokens":60}}}\n\n',
    );
    const { streamRaw } = finishAnthropicSsePartial(state);
    const usage = parseAnthropicUsage(streamRaw);
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.cacheReadTokens, 60);
  });

  it("T-S2: 双槽皆空时降级 {streamed:true,aborted:true} 且不抛错", () => {
    const state = createAnthropicSseParserState();
    const { streamRaw } = finishAnthropicSsePartial(state);
    assert.deepEqual(streamRaw, { streamed: true, aborted: true });
    assert.equal(parseAnthropicUsage(streamRaw), undefined);
  });

});
