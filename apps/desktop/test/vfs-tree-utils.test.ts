import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestorDirPaths,
  logicalPathForSegmentIndex,
  logicalPathSegments,
} from "@/features/workspace/vfs-tree-utils";

test("logicalPathSegments 拆分逻辑路径段", () => {
  const cases: Array<{ path: string; expected: string[] }> = [
    { path: "/notes/ch1.md", expected: ["notes", "ch1.md"] },
    { path: "/a/b/c.md", expected: ["a", "b", "c.md"] },
    { path: "/single.txt", expected: ["single.txt"] },
    { path: "/", expected: [] },
    { path: "/notes/", expected: ["notes"] },
  ];
  for (const { path, expected } of cases) {
    assert.deepEqual(logicalPathSegments(path), expected, path);
  }
});

test("logicalPathForSegmentIndex 返回段前缀绝对路径", () => {
  const segments = ["notes", "ch1.md"] as const;
  assert.equal(logicalPathForSegmentIndex(segments, 0), "/notes");
  assert.equal(logicalPathForSegmentIndex(segments, 1), "/notes/ch1.md");
  assert.throws(
    () => logicalPathForSegmentIndex(segments, 2),
    RangeError,
  );
});

test("ancestorDirPaths 返回根到目标目录链", () => {
  assert.deepEqual(ancestorDirPaths("/"), ["/"]);
  assert.deepEqual(ancestorDirPaths("/notes"), ["/", "/notes"]);
  assert.deepEqual(ancestorDirPaths("/a/b"), ["/", "/a", "/a/b"]);
  assert.deepEqual(ancestorDirPaths("/notes/ch1.md"), [
    "/",
    "/notes",
    "/notes/ch1.md",
  ]);
});
