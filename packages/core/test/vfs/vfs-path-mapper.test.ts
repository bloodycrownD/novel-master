import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertLogicalPathAllowed, resolveLogicalPath, toLogicalPath, toPhysicalPath, isVfsError } from "@novel-master/core/vfs";
import { scopeKey, scopePhysicalPrefix } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { stripKnownPhysicalPrefixes } from "@/domain/vfs/logic/strip-known-physical-prefixes.js";

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
        assert.ok(isVfsError(e, "INVALID_PATH"));
        return true;
      },
    );
    assert.throws(
      () => assertLogicalPathAllowed({ kind: "global" }, "/template"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "INVALID_PATH"));
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

  it("global-meta：物理前缀 /meta，scopeKey global:meta", () => {
    const scope = { kind: "global-meta" as const };
    assert.equal(toPhysicalPath(scope, "/"), "/meta");
    assert.equal(
      toPhysicalPath(scope, "/skills/foo/SKILL.md"),
      "/meta/skills/foo/SKILL.md",
    );
    assert.equal(
      toLogicalPath(scope, "/meta/skills/foo/SKILL.md"),
      "/skills/foo/SKILL.md",
    );
    assert.equal(toLogicalPath(scope, "/meta"), "/");
    assert.equal(scopeKey(scope), "global:meta");
    assert.equal(scopePhysicalPrefix(scope), "/meta");
    // 域外物理路径拒绝
    assert.throws(
      () => toLogicalPath(scope, "/template/a.md"),
      (e: unknown) => isVfsError(e, "INVALID_PATH"),
    );
  });

  it("project-meta：物理前缀 /projects/{pid}/meta，scopeKey project:{pid}:meta", () => {
    const scope = { kind: "project-meta" as const, projectId: "p1" };
    assert.equal(toPhysicalPath(scope, "/"), "/projects/p1/meta");
    assert.equal(
      toPhysicalPath(scope, "/skills/foo/SKILL.md"),
      "/projects/p1/meta/skills/foo/SKILL.md",
    );
    assert.equal(
      toLogicalPath(scope, "/projects/p1/meta/skills/foo/SKILL.md"),
      "/skills/foo/SKILL.md",
    );
    assert.equal(toLogicalPath(scope, "/projects/p1/meta"), "/");
    assert.equal(scopeKey(scope), "project:p1:meta");
    assert.equal(scopePhysicalPrefix(scope), "/projects/p1/meta");
    // 不得误吃同项目 template / 隔壁项目 meta 前缀
    assert.throws(
      () => toLogicalPath(scope, "/projects/p1/template/a.md"),
      (e: unknown) => isVfsError(e, "INVALID_PATH"),
    );
    assert.throws(
      () => toLogicalPath(scope, "/projects/p2/meta/skills/a/SKILL.md"),
      (e: unknown) => isVfsError(e, "INVALID_PATH"),
    );
  });

  it("脱敏规则剥离 meta 两域物理前缀（先具体后泛化）", () => {
    assert.equal(
      stripKnownPhysicalPrefixes(
        "not found: /projects/p1/meta/skills/foo/SKILL.md",
      ),
      "not found: /skills/foo/SKILL.md",
    );
    assert.equal(
      stripKnownPhysicalPrefixes("not found: /meta/skills/foo/SKILL.md"),
      "not found: /skills/foo/SKILL.md",
    );
    // 既有三域规则不回退
    assert.equal(
      stripKnownPhysicalPrefixes(
        "not found: /projects/p1/template/a.md at /template/b.md",
      ),
      "not found: /a.md at /b.md",
    );
  });
});
