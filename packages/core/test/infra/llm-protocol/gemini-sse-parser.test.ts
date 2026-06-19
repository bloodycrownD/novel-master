import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGeminiSseParserState,
  feedGeminiSseChunk,
  finishGeminiSse,
  finishGeminiSsePartial,
} from "../../../src/infra/llm-protocol/logic/gemini-sse-parser.js";

describe("gemini-sse-parser", () => {
  it("T6: parses incremental text SSE and done", () => {
    const state = createGeminiSseParserState();
    const deltas: string[] = [];

    feedGeminiSseChunk(
      state,
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"}}]}',
        "",
      ].join("\n"),
      (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    );

    const { blocks } = finishGeminiSse(state);
    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(blocks.length, 1);
    if (blocks[0]?.type === "text") {
      assert.equal(blocks[0].text, "Hello");
    }
  });

  it("T7b: strips inline >thought leak when structured thought parts exist", () => {
    const state = createGeminiSseParserState();
    const streamEvents: Array<{ type: string; text?: string }> = [];
    const onStream = (ev: { type: string; text?: string }) => {
      streamEvents.push(ev);
    };

    feedGeminiSseChunk(
      state,
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true}]}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"黎明前94>thought plan\\n\\n"}]}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"你好。"}]}}]}',
        "",
      ].join("\n"),
      onStream,
    );

    const leakDelta = streamEvents.find(
      (ev) =>
        ev.type === "text-delta" &&
        ev.text != null &&
        ev.text.includes(">thought"),
    );
    assert.ok(leakDelta, "默认直通：含 >thought 的 chunk 应以 text-delta 原文流出");

    const { blocks } = finishGeminiSse(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "thinking");
    assert.equal(blocks[1]?.type, "text");
    if (blocks[1]?.type === "text") {
      assert.equal(blocks[1].text, "你好。");
    }
  });

  it("extracts thought_signature from streamed thinking parts", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true,"thought_signature":"sig-stream"}]}}]}\n',
    );
    const { blocks } = finishGeminiSse(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].thinkingSignature, "sig-stream");
    }
  });

  it("functionCall thought_signature stays on tool_use, not empty thinking block", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"/a"},"id":"call_1"},"thought_signature":"sig-fc-only"}]}}]}\n',
    );
    const { blocks } = finishGeminiSse(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_use");
    if (blocks[0]?.type === "tool_use") {
      assert.equal(blocks[0].name, "read");
      assert.equal(blocks[0].thinkingSignature, "sig-fc-only");
    }
  });

  it("functionCall 参数增长时累积 args 并在 finish 时 emit tool-use", () => {
    const state = createGeminiSseParserState();
    const toolUses: unknown[] = [];
    const onStream = (ev: { type: string; name?: string }) => {
      if (ev.type === "tool-use") {
        toolUses.push(ev);
      }
    };

    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"write","args":{"path":"/a"},"id":"c1"}}]}}]}\n',
      onStream,
    );
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"write","args":{"path":"/a","content":"hello"},"id":"c1"}}]}}]}\n',
      onStream,
    );

    finishGeminiSse(state, onStream);
    assert.equal(toolUses.length, 1);
  });

  it("T7: abort partial keeps thinking without empty text", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"text":"thought","thought":true}]}}]}\n',
    );
    const { blocks } = finishGeminiSsePartial(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
  });
});
