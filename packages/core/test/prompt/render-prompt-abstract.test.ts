import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptLlmInput, type PromptBlock } from "@novel-master/core";

describe("buildPromptLlmInput abstract + when", () => {
  const blocks: PromptBlock[] = [
    { name: "base", type: "text", role: "system", content: "base" },
    {
      name: "abstract",
      type: "text",
      role: "system",
      content: "摘要：{{.abstract}}",
      when: { present: "abstract" },
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

  it("safe macro: missing abstract in template does not throw", () => {
    const onlyAbstractMacro: PromptBlock[] = [
      {
        name: "a",
        type: "text",
        role: "system",
        content: "{{.abstract}}",
      },
    ];
    const input = buildPromptLlmInput(onlyAbstractMacro, {
      worktreeDisplay: "WT",
      messages: [],
    });
    assert.equal(input.system, "");
  });
});
