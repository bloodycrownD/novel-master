import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStreamPartialBlocks } from "../../../src/infra/llm-protocol/logic/stream-partial-blocks.js";

describe("buildStreamPartialBlocks", () => {
  it("T1: keeps partial thinking without empty text block", () => {
    const blocks = buildStreamPartialBlocks({
      text: "",
      thinking: "half thought",
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "half thought");
    }
  });

  it("T2: returns empty when nothing streamed", () => {
    assert.deepEqual(buildStreamPartialBlocks({ text: "", thinking: "" }), []);
  });

  it("includes text and tool_use when present", () => {
    const blocks = buildStreamPartialBlocks({
      text: "hi",
      thinking: "",
      toolUses: [{ id: "1", name: "vfs.read", input: { path: "/a" } }],
    });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "text");
    assert.equal(blocks[1]?.type, "tool_use");
  });
});
