import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openAiStreamAccumulatorsToPartialBlocks,
  openAiStreamDeltaToEvents,
} from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";
import { createOpenAiSseParserState } from "../../../src/infra/llm-protocol/logic/openai-sse-parser.js";

describe("openAiStreamAccumulatorsToPartialBlocks", () => {
  it("keeps partial thinking without empty text block", () => {
    const state = createOpenAiSseParserState();
    state.thinkingParts.push("half thought");
    const blocks = openAiStreamAccumulatorsToPartialBlocks(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "half thought");
    }
  });

  it("returns empty when nothing streamed", () => {
    const state = createOpenAiSseParserState();
    assert.deepEqual(openAiStreamAccumulatorsToPartialBlocks(state), []);
  });

  it("T-partial-abort: 流中带标签 mid-stream 不丢字、不 panic", () => {
    const state = createOpenAiSseParserState();
    openAiStreamDeltaToEvents({ content: "<thought>half" }, state);
    openAiStreamDeltaToEvents({ content: " thought</thought>可见" }, state);
    state.thinkingParts.push("structured");

    const blocks = openAiStreamAccumulatorsToPartialBlocks(state);
    const thinking = blocks.find((b) => b.type === "thinking");
    const text = blocks.find((b) => b.type === "text");
    assert.ok(thinking && thinking.type === "thinking");
    assert.ok(text && text.type === "text");
    assert.match(thinking.text, /half thought/);
    assert.equal(text.text, "可见");
  });
});
