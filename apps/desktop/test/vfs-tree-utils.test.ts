import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestorDirPaths,
  isDirectChild,
  logicalPathForSegmentIndex,
  logicalPathSegments,
  parentLogicalPath,
  vfsEntryStatusText,
} from "@/features/workspace/vfs-tree-utils";
import type { WorkplaceListRowDto } from "@shared/ipc-types";

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

test("parentLogicalPath / isDirectChild 与 Mobile 对齐", () => {
  assert.equal(parentLogicalPath("/"), null);
  assert.equal(parentLogicalPath("/notes"), "/");
  assert.equal(parentLogicalPath("/notes/ch1.md"), "/notes");
  assert.equal(isDirectChild("/", "/a.md"), true);
  assert.equal(isDirectChild("/", "/sub/a.md"), false);
  assert.equal(isDirectChild("/notes", "/notes/a.md"), true);
  assert.equal(isDirectChild("/", "/"), false);
});

test("T-WEC15：vfsEntryStatusText 正向映射 enum 为中文标签", () => {
  const dirOn: WorkplaceListRowDto = {
    kind: "dir",
    path: "/notes",
    ruleState: "rule_on",
  };
  const dirOff: WorkplaceListRowDto = {
    kind: "dir",
    path: "/drafts",
    ruleState: "rule_off",
  };
  const fileRow: WorkplaceListRowDto = {
    kind: "file",
    path: "/a.md",
    inclusionMode: "show",
    displayState: "full",
  };

  assert.equal(vfsEntryStatusText(dirOn), "规则·开");
  assert.equal(vfsEntryStatusText(dirOff), "规则·关");
  assert.equal(vfsEntryStatusText(fileRow), "展示 · 全内容");
});
