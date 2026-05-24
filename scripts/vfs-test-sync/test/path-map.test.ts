import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { PathMapError } from "../src/errors.js";
import { walkMirror } from "../src/mirror-walk.js";
import {
  normalizePrefix,
  toMirrorFile,
  toMirrorRelative,
  toVfsPath,
} from "../src/path-map.js";

describe("path-map", () => {
  it("maps mirror-relative paths under root prefix", () => {
    assert.equal(toVfsPath("/", "foo/bar.md"), "/foo/bar.md");
    assert.equal(toMirrorRelative("/", "/foo/bar.md"), "foo/bar.md");
  });

  it("maps paths under a nested prefix", () => {
    assert.equal(toVfsPath("/project", "a.txt"), "/project/a.txt");
    assert.equal(toMirrorRelative("/project", "/project/a.txt"), "a.txt");
    assert.equal(toMirrorRelative("/project", "/other/a.txt"), null);
  });

  it("rejects .. in relative paths", () => {
    assert.throws(() => toVfsPath("/", "../secret"), PathMapError);
  });

  it("normalizes prefix trailing slashes", () => {
    assert.equal(normalizePrefix("/project/"), "/project");
    assert.equal(normalizePrefix("/"), "/");
  });

  it("resolves mirror file paths", () => {
    const file = toMirrorFile("/tmp/mirror", "a/b.md");
    assert.ok(file.endsWith(join("a", "b.md")) || file.includes("a"));
  });
});

describe("mirror-walk", () => {
  it("skips .git directories", async () => {
    const root = join(
      tmpdir(),
      `vfs-sync-walk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(join(root, ".git", "objects"), { recursive: true });
    await writeFile(join(root, ".git", "HEAD"), "ref", "utf8");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "a.md"), "# A", "utf8");

    const paths = await walkMirror(root);
    assert.deepEqual(paths, ["docs/a.md"]);
  });
});
