import assert from "node:assert/strict";
import test from "node:test";
import { joinVfsPath } from "../renderer/utils/vfs-path";

test("joinVfsPath builds paths under root", () => {
  assert.equal(joinVfsPath("/", "a.txt"), "/a.txt");
  assert.equal(joinVfsPath("/", "docs/readme.md"), "/docs/readme.md");
});

test("joinVfsPath builds paths under directory", () => {
  assert.equal(joinVfsPath("/docs", "a.txt"), "/docs/a.txt");
  assert.equal(joinVfsPath("/docs/", "sub"), "/docs/sub");
});

test("joinVfsPath normalizes slashes", () => {
  assert.equal(joinVfsPath("//docs//", "//a.txt"), "/docs/a.txt");
});
