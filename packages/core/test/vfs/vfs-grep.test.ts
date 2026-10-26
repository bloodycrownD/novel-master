import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { grepContents } from "../../src/domain/vfs/logic/vfs-grep.js";

function grep(...args: Parameters<typeof grepContents>) {
  const result = grepContents(...args);
  assert.ok(result.ok);
  return result.value;
}

const rows = [
  {
    path: "/a.ts",
    content: "const foo = 1;\nconst bar = 2;\n// TODO fix\n",
  },
  {
    path: "/b.md",
    content: "# Title\nFOO bar\n",
  },
];

describe("grepContents", () => {
  it("literal substring matches multiple columns on one line", () => {
    const hits = grep(rows, "o", { matchMode: "literal" });
    assert.ok(hits.some((h) => h.path === "/a.ts" && h.line === 1 && h.column > 1));
  });

  it("regex mode supports patterns", () => {
    const hits = grep(rows, "const \\w+ =", { matchMode: "regex" });
    assert.equal(hits.length, 2);
    assert.deepEqual(
      hits.map((h) => h.line),
      [1, 2]
    );
  });

  it("auto mode treats invalid regex as literal", () => {
    const hits = grep(rows, "(unclosed", { matchMode: "auto" });
    assert.equal(hits.length, 0);
    const hashHits = grep(rows, "#", { matchMode: "auto" });
    assert.equal(hashHits.length, 1);
    assert.equal(hashHits[0]!.path, "/b.md");
  });

  it("caseInsensitive matches regardless of case", () => {
    const hits = grep(rows, "foo", {
      matchMode: "literal",
      caseInsensitive: true,
    });
    assert.equal(hits.length, 2);
  });

  it("invert returns non-matching lines only", () => {
    const hits = grep([{ path: "/x", content: "match\nnomatch\nother" }], "^match$", { invert: true, matchMode: "regex" });
    assert.equal(hits.length, 2);
    assert.deepEqual(
      hits.map((h) => h.line),
      [2, 3]
    );
  });

  it("contextLines expands excerpt", () => {
    const hits = grep(rows, "TODO", {
      matchMode: "literal",
      contextLines: 1,
    });
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.excerpt, /const bar/);
    assert.match(hits[0]!.excerpt, /TODO/);
  });

  it("oneMatchPerFile returns at most one hit per file", () => {
    const hits = grep(rows, "o", {
      matchMode: "literal",
      oneMatchPerFile: true,
    });
    const byPath = new Map<string, number>();
    for (const h of hits) {
      byPath.set(h.path, (byPath.get(h.path) ?? 0) + 1);
    }
    assert.ok([...byPath.values()].every((n) => n === 1));
  });

  it("regex mode returns VFS_INVALID_PATTERN for invalid regex", () => {
    const result = grepContents(rows, "(unclosed", { matchMode: "regex" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.key, "VFS_INVALID_PATTERN");
    }
  });
});
