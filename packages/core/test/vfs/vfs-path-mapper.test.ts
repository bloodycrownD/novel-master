import { unwrap } from "../helpers/result-unwrap.js";
import { isAppError } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLogicalPath, toLogicalPath, toPhysicalPath, validateLogicalPath } from "@novel-master/core/vfs";
import { scopeKey, scopePhysicalPrefix } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { stripKnownPhysicalPrefixes } from "@/domain/vfs/logic/strip-known-physical-prefixes.js";

/** 解包 Result 成功分支；失败直接让测试失败。 */
function unwrapPath(result: ReturnType<typeof resolveLogicalPath>): string {
  return result.ok ? result.value : assert.fail(`意外失败：${result.error.message}`);
}

describe("vfs-path-mapper", () => {
  it("resolveLogicalPath normalizes relative input", () => {
    assert.equal(unwrapPath(resolveLogicalPath("notes/a.md")), "/notes/a.md");
    assert.equal(unwrapPath(resolveLogicalPath("/notes/a.md")), "/notes/a.md");
  });

  it("global toPhysicalPath maps logical root to /template", () => {
    assert.equal(unwrap(toPhysicalPath({ kind: "global" }, "/")), "/template");
    assert.equal(unwrap(toPhysicalPath({ kind: "global" }, "/seed/hello.md")), "/template/seed/hello.md");
  });

  it("global toLogicalPath strips /template prefix", () => {
    assert.equal(unwrap(toLogicalPath({ kind: "global" }, "/template/seed/hello.md")), "/seed/hello.md");
    assert.equal(unwrap(toLogicalPath({ kind: "global" }, "/template")), "/");
  });

  it("rejects legacy /template logical paths", () => {
    for (const logical of ["/template/legacy.md", "/template"]) {
      const rejected = validateLogicalPath({ kind: "global" }, logical);
      assert.ok(!rejected.ok, "legacy /template 前缀必须走 Err 分支（不再 throw）");
      if (!rejected.ok) assert.ok(isAppError(rejected.error, "VFS_INVALID_PATH"));
    }
  });

  it("allows /my-template as user subdirectory", () => {
    assert.ok(validateLogicalPath({ kind: "global" }, "/my-template/readme.md").ok, "/my-template 是用户子目录，应放行");
  });

  it("project maps logical paths under project template prefix", () => {
    const scope = { kind: "project" as const, projectId: "p1" };
    assert.equal(unwrap(toPhysicalPath(scope, "/prompts/system.md")), "/projects/p1/template/prompts/system.md");
    assert.equal(unwrap(toLogicalPath(scope, "/projects/p1/template/prompts/system.md")), "/prompts/system.md");
  });

  it("global-meta：物理 = 逻辑原样（自带 /meta 段），scopeKey global:meta", () => {
    const scope = { kind: "global-meta" as const };
    assert.equal(unwrap(toPhysicalPath(scope, "/meta/skills/foo/SKILL.md")), "/meta/skills/foo/SKILL.md");
    assert.equal(unwrap(toLogicalPath(scope, "/meta/skills/foo/SKILL.md")), "/meta/skills/foo/SKILL.md");
    assert.equal(scopeKey(scope), "global:meta");
    // 逻辑路径自带 /meta 段，挂载前缀为空串
    assert.equal(scopePhysicalPrefix(scope), "");
  });

  it("project-meta：物理前缀 /projects/{pid}（逻辑自带 /meta 段），scopeKey project:{pid}:meta", () => {
    const scope = { kind: "project-meta" as const, projectId: "p1" };
    assert.equal(unwrap(toPhysicalPath(scope, "/meta/skills/foo/SKILL.md")), "/projects/p1/meta/skills/foo/SKILL.md");
    assert.equal(unwrap(toLogicalPath(scope, "/projects/p1/meta/skills/foo/SKILL.md")), "/meta/skills/foo/SKILL.md");
    assert.equal(unwrap(toLogicalPath(scope, "/projects/p1/meta")), "/meta");
    assert.equal(scopeKey(scope), "project:p1:meta");
    // 逻辑路径自带 /meta 段，挂载前缀仅项目段
    assert.equal(scopePhysicalPrefix(scope), "/projects/p1");
    // 不得误吃同项目 template / 隔壁项目 meta 前缀：越 scope 返回 Err（不再 throw）
    for (const physical of ["/projects/p1/template/a.md", "/projects/p2/meta/skills/a/SKILL.md"]) {
      const rejected = toLogicalPath(scope, physical);
      assert.ok(!rejected.ok, `越 scope 必须走 Err 分支：${physical}`);
      if (!rejected.ok) assert.ok(isAppError(rejected.error, "VFS_INVALID_PATH"));
    }
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
