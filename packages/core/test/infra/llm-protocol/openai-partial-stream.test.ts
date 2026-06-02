import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openAiStreamAccumulatorsToPartialBlocks } from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";
import { createOpenAiSseParserState } from "../../../src/infra/llm-protocol/logic/openai-sse-parser.js";

describe("openAiStreamAccumulatorsToPartialBlocks", () => {
  it("keeps partial thinking and empty text block", () => {
    const state = createOpenAiSseParserState();
    state.thinkingParts.push("half thought");
    const blocks = openAiStreamAccumulatorsToPartialBlocks(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "thinking");
    assert.equal(blocks[1]?.type, "text");
    if (blocks[1]?.type === "text") {
      assert.equal(blocks[1].text, "");
    }
  });

  it("returns empty when nothing streamed", () => {
    const state = createOpenAiSseParserState();
    assert.deepEqual(openAiStreamAccumulatorsToPartialBlocks(state), []);
  });
});
