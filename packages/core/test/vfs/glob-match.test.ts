import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  GlobMatch  } from "@/service/vfs/glob-match.js";

describe("matchGlob", () => {
    it("matches single-segment wildcards", () => {
        assert.equal(GlobMatch.match("*.md", "/readme.md"), true);
        assert.equal(GlobMatch.match("*.md", "/readme.txt"), false);
    });

    it("matches ** across directories", () => {
        assert.equal(GlobMatch.match("**/*.md", "/chapters/a/foo.md"), true);
        assert.equal(GlobMatch.match("**/*.md", "/chapters/a/foo.txt"), false);
    });

    it("matches ? for single character", () => {
        assert.equal(GlobMatch.match("/a?c", "/abc"), true);
        assert.equal(GlobMatch.match("/a?c", "/abbc"), false);
    });
});
