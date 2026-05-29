import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptLlmInput, type PromptBlock } from "@novel-master/core";

describe("buildPromptLlmInput abstract block", () => {
  const blocks: PromptBlock[] = [
    { name: "base", type: "text", role: "system", content: "base" },
    {
      name: "abstract",
      type: "abstract",
      content: "摘要：{{.abstract}}",
    },
  ];

  it("T6: skips abstract block when empty", () => {
    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "",
      messages: [],
      abstract: "",
    });
    assert.equal(input.system, "base");
    assert.ok(!input.system?.includes("摘要"));
  });

  it("T7: includes rendered abstract when present", () => {
    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "",
      messages: [],
      abstract: "compressed history",
    });
    assert.match(input.system ?? "", /摘要：compressed history/);
  });

  it("skips abstract block when abstract is whitespace only", () => {
    const input = buildPromptLlmInput(blocks, {
      worktreeDisplay: "",
      messages: [],
      abstract: "   ",
    });
    assert.equal(input.system, "base");
  });

  it("T6: merges system text then abstract in block order", () => {
    const ordered: PromptBlock[] = [
      { name: "base", type: "text", role: "system", content: "base" },
      { name: "abstract", type: "abstract", content: "摘要：{{.abstract}}" },
      { name: "history", type: "chat" },
    ];
    const input = buildPromptLlmInput(ordered, {
      worktreeDisplay: "",
      messages: [],
      abstract: "hist",
    });
    assert.match(input.system ?? "", /^base\n摘要：hist$/);
    assert.equal(input.messages.length, 0);
  });
});
