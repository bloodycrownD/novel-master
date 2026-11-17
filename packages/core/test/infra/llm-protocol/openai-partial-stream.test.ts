import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openAiStreamAccumulatorsToPartialBlocks,
  openAiStreamDeltaToEvents,
} from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";
import { createOpenAiSseParser } from "../../../src/infra/llm-protocol/logic/openai-sse-parser.js";

describe("openAiStreamAccumulatorsToPartialBlocks", () => {
  it("keeps partial thinking without empty text block", () => {
    const parser = createOpenAiSseParser();
    parser.state.thinkingParts.push("half thought");
    const blocks = openAiStreamAccumulatorsToPartialBlocks(parser.state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "half thought");
    }
  });

  it("returns empty when nothing streamed", () => {
    const parser = createOpenAiSseParser();
    assert.deepEqual(openAiStreamAccumulatorsToPartialBlocks(parser.state), []);
  });

  it("T-partial-abort: 流中带标签 mid-stream 不丢字、不 panic，标签留在 text", () => {
    const parser = createOpenAiSseParser();
    openAiStreamDeltaToEvents({ content: "<thought>half" }, parser.state);
    openAiStreamDeltaToEvents({ content: " thought</thought>可见" }, parser.state);
    parser.state.thinkingParts.push("structured");

    const blocks = openAiStreamAccumulatorsToPartialBlocks(parser.state);
    const thinking = blocks.find((b) => b.type === "thinking");
    const text = blocks.find((b) => b.type === "text");
    assert.ok(thinking && thinking.type === "thinking");
    assert.ok(text && text.type === "text");
    assert.equal(thinking.text, "structured");
    assert.equal(text.text, "<thought>half thought</thought>可见");
  });
});
