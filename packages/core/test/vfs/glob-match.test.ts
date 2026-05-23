import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchGlob } from "../../src/service/vfs/glob-match.js";

describe("matchGlob", () => {
  it("matches single-segment wildcards", () => {
    assert.equal(matchGlob("*.md", "/readme.md"), true);
    assert.equal(matchGlob("*.md", "/readme.txt"), false);
  });

  it("matches ** across directories", () => {
    assert.equal(matchGlob("**/*.md", "/chapters/a/foo.md"), true);
    assert.equal(matchGlob("**/*.md", "/chapters/a/foo.txt"), false);
  });

  it("matches ? for single character", () => {
    assert.equal(matchGlob("/a?c", "/abc"), true);
    assert.equal(matchGlob("/a?c", "/abbc"), false);
  });
});
