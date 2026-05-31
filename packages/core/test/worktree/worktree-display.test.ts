import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  joinFileBlocks,
  parseMarkdownFrontMatter,
  renderFileBlock,
  splitMarkdownFrontMatter,
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
    assert.match(block, /createdAt="[^"]+"/);
    assert.match(block, /updatedAt="[^"]+"/);
  });

  it("parses valid front matter", () => {
    const lines = parseMarkdownFrontMatter("---\ntitle: x\n---\nbody");
    assert.deepEqual(lines, ["1|title: x"]);
  });

  it("splits front matter from markdown body", () => {
    const split = splitMarkdownFrontMatter("---\ntitle: x\n---\n# Hi\n");
    assert.equal(split.closed, true);
    assert.deepEqual(split.frontMatterLines, ["title: x"]);
    assert.equal(split.body, "# Hi\n");
  });

  it("split without front matter returns full body", () => {
    const split = splitMarkdownFrontMatter("# Only\n");
    assert.equal(split.frontMatterLines, null);
    assert.equal(split.body, "# Only\n");
    assert.equal(split.closed, true);
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
