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

  it("T7: abort partial keeps thinking + empty text", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"text":"thought","thought":true}]}}]}\n',
    );
    const { blocks } = finishGeminiSsePartial(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "thinking");
    assert.equal(blocks[1]?.type, "text");
  });
});
