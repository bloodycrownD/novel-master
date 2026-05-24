import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PromptError, parsePromptYaml } from "@novel-master/core";

describe("parsePromptYaml", () => {
  it("parses valid blocks array", () => {
    const blocks = parsePromptYaml(`
blocks:
  - name: a
    type: text
    role: system
    content: hi
`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "text");
  });

  it("rejects malformed YAML", () => {
    assert.throws(
      () => parsePromptYaml("blocks: [\n  - bad"),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_YAML");
        return true;
      },
    );
  });

  it("rejects non-object root", () => {
    assert.throws(
      () => parsePromptYaml("- not an object"),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_YAML");
        return true;
      },
    );
  });

  it("rejects missing blocks array", () => {
    assert.throws(
      () => parsePromptYaml("name: only"),
      (error: unknown) => {
        assert.ok(error instanceof PromptError);
        assert.equal(error.code, "INVALID_YAML");
        return true;
      },
    );
  });
});
