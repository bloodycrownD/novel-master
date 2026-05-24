import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  joinFileBlocks,
  parseMarkdownFrontMatter,
  renderFileBlock,
} from "@novel-master/core";

describe("worktree display", () => {
  it("escapes XML in path attribute", () => {
    const block = renderFileBlock({
      logicalPath: '/template/a&b"c.md',
      mtimeMs: 1_700_000_000_000,
      display: "filename",
      content: "",
    });
    assert.match(block, /path="\/template\/a&amp;b&quot;c\.md"/);
  });

  it("parses valid front matter", () => {
    const lines = parseMarkdownFrontMatter("---\ntitle: x\n---\nbody");
    assert.deepEqual(lines, ["1|title: x"]);
  });

  it("degrades invalid front matter", () => {
    const lines = parseMarkdownFrontMatter("---\nno close");
    assert.deepEqual(lines, ["1|（Front Matter 格式无效）"]);
  });

  it("joins blocks with blank line", () => {
    const a = renderFileBlock({
      logicalPath: "/a.md",
      mtimeMs: 0,
      display: "filename",
      content: "",
    });
    const b = renderFileBlock({
      logicalPath: "/b.md",
      mtimeMs: 0,
      display: "filename",
      content: "",
    });
    assert.equal(joinFileBlocks([a, b]).split("\n\n").length, 2);
  });
});
