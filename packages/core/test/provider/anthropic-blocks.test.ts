import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AnthropicProtocolAdapter } from "../../src/infra/llm-protocol/impl/anthropic.adapter.js";
import {
  anthropicContentToBlocks,
  blocksToAnthropicContent,
} from "../../src/infra/llm-protocol/logic/anthropic-content-mapper.js";

describe("anthropic content mapper", () => {
  it("drops empty text segments from API response", () => {
    const blocks = anthropicContentToBlocks([
      { type: "text", text: "" },
      { type: "tool_use", id: "tu_1", name: "grep", input: {} },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "tool_use");
  });

  it("maps tool_use and text from API response", () => {
    const blocks = anthropicContentToBlocks([
      {
        type: "tool_use",
        id: "tu_1",
        name: "grep",
        input: { pattern: "foo" },
      },
      { type: "text", text: "done" },
    ]);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "tool_use");
    assert.equal(blocks[1]!.type, "text");
    assert.equal(blocks[1]!.type === "text" && blocks[1].text, "done");
  });

  it("blocksToAnthropicContent includes tool_use", () => {
    const api = blocksToAnthropicContent([
      {
        type: "tool_use",
        id: "tu_1",
        name: "grep",
        input: { pattern: "x" },
      },
    ]);
    assert.equal(api[0]?.type, "tool_use");
  });
});

describe("AnthropicProtocolAdapter blocks", () => {
  it("returns blocks from multi-part response", async () => {
    const fetchFn = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "grep",
              input: { pattern: "foo" },
            },
            { type: "text", text: "summary" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
    const result = await adapter.chat({
      baseUrl: "https://api.anthropic.com",
      apiKey: "key",
      vendorModelId: "claude-3-5-sonnet",
      userContent: "hello",
    });

    assert.equal(result.blocks.length, 2);
    assert.equal(result.blocks[0]!.type, "tool_use");
    assert.ok(result.assistantText.includes("summary"));
  });
});
