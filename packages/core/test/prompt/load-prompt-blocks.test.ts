import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptError, loadPromptBlocksFromYaml } from "@novel-master/core";

describe("loadPromptBlocksFromYaml", () => {
  it("parses blocks array", () => {
    const blocks = loadPromptBlocksFromYaml(`
blocks:
  - name: a
    type: text
    role: system
    content: hi
`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.name, "a");
  });

  it("throws on invalid YAML", () => {
    assert.throws(
      () => loadPromptBlocksFromYaml("blocks: [\n  - bad"),
      (e: unknown) => e instanceof PromptError,
    );
  });

  it("throws when blocks missing", () => {
    assert.throws(
      () => loadPromptBlocksFromYaml("name: only"),
      (e: unknown) => e instanceof PromptError && e.code === "INVALID_YAML",
    );
  });
});
