import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@novel-master/core/workplace";

describe("DEFAULT_WORKPLACE_DIR_RULE", () => {
  it("默认 fillPolicy 为 header", () => {
    assert.equal(DEFAULT_WORKPLACE_DIR_RULE.fillPolicy, "header");
  });
});
