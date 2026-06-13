import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_WORKTREE_DIR_RULE } from "@novel-master/core";

describe("DEFAULT_WORKTREE_DIR_RULE", () => {
  it("默认 fillPolicy 为 header", () => {
    assert.equal(DEFAULT_WORKTREE_DIR_RULE.fillPolicy, "header");
  });
});
