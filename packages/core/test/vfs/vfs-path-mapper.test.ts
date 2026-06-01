import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLogicalPathAllowed,
  resolveLogicalPath,
  toLogicalPath,
  toPhysicalPath,
  VfsError,
} from "@novel-master/core";

describe("vfs-path-mapper", () => {
  it("resolveLogicalPath normalizes relative input", () => {
    assert.equal(resolveLogicalPath("notes/a.md"), "/notes/a.md");
    assert.equal(resolveLogicalPath("/notes/a.md"), "/notes/a.md");
  });

  it("global toPhysicalPath maps logical root to /template", () => {
    assert.equal(toPhysicalPath({ kind: "global" }, "/"), "/template");
    assert.equal(
      toPhysicalPath({ kind: "global" }, "/seed/hello.md"),
      "/template/seed/hello.md",
    );
  });

  it("global toLogicalPath strips /template prefix", () => {
    assert.equal(
      toLogicalPath({ kind: "global" }, "/template/seed/hello.md"),
      "/seed/hello.md",
    );
    assert.equal(toLogicalPath({ kind: "global" }, "/template"), "/");
  });

  it("rejects legacy /template logical paths", () => {
    assert.throws(
      () => assertLogicalPathAllowed({ kind: "global" }, "/template/legacy.md"),
      (e: unknown) => {
        assert.ok(e instanceof VfsError);
        assert.equal(e.code, "INVALID_PATH");
        return true;
      },
    );
  });

  it("allows /my-template as user subdirectory", () => {
    assert.doesNotThrow(() =>
      assertLogicalPathAllowed({ kind: "global" }, "/my-template/readme.md"),
    );
  });

  it("project maps logical paths under project template prefix", () => {
    const scope = { kind: "project" as const, projectId: "p1" };
    assert.equal(
      toPhysicalPath(scope, "/prompts/system.md"),
      "/projects/p1/template/prompts/system.md",
    );
    assert.equal(
      toLogicalPath(scope, "/projects/p1/template/prompts/system.md"),
      "/prompts/system.md",
    );
  });
});
