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
    );
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

  it("functionCall 参数增长时 emit tool-use-delta", () => {
    const state = createGeminiSseParserState();
    const toolDeltas: string[] = [];
    const onStream = (ev: { type: string; delta?: string }) => {
      if (ev.type === "tool-use-delta" && ev.delta != null) {
        toolDeltas.push(ev.delta);
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
    assert.equal(toolDeltas.length, 2);
    assert.ok(toolDeltas.every((d) => d.length > 0));
    const finalJson = JSON.stringify({ path: "/a", content: "hello" });
    assert.ok(
      toolDeltas.reduce((n, d) => n + d.length, 0) >= finalJson.length,
    );
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
