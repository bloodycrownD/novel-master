import {  unwrap  } from "../helpers/result-unwrap.js";
import {  AppErrorOps  } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  LogicalPath  } from "@novel-master/core/vfs";
import {  KnownPhysicalPrefixes  } from "@/domain/vfs/logic/strip-known-physical-prefixes.js";

/** 解包 Result 成功分支；失败直接让测试失败。 */
function unwrapPath(result: ReturnType<typeof LogicalPath.resolve>): string {
    return result.ok ? result.value : assert.fail(`意外失败：${result.error.message}`);
}

describe("vfs-path-mapper", () => {
    it("LogicalPath.resolve normalizes relative input", () => {
        assert.equal(unwrapPath(LogicalPath.resolve("notes/a.md")), "/notes/a.md");
        assert.equal(unwrapPath(LogicalPath.resolve("/notes/a.md")), "/notes/a.md");
    });

    it("global LogicalPath.toPhysical maps logical root to /template", () => {
        assert.equal(unwrap(LogicalPath.toPhysical({ kind: "global" }, "/")), "/template");
        assert.equal(unwrap(LogicalPath.toPhysical({ kind: "global" }, "/seed/hello.md")), "/template/seed/hello.md");
    });

    it("global LogicalPath.toLogical strips /template prefix", () => {
        assert.equal(unwrap(LogicalPath.toLogical({ kind: "global" }, "/template/seed/hello.md")), "/seed/hello.md");
        assert.equal(unwrap(LogicalPath.toLogical({ kind: "global" }, "/template")), "/");
    });

    it("rejects legacy /template logical paths", () => {
        for (const logical of ["/template/legacy.md", "/template"]) {
            const rejected = LogicalPath.validate({ kind: "global" }, logical);
            assert.ok(!rejected.ok, "legacy /template 前缀必须走 Err 分支（不再 throw）");
            if (!rejected.ok) assert.ok(AppErrorOps.is(rejected.error, "VFS_INVALID_PATH"));
        }
    });

    it("allows /my-template as user subdirectory", () => {
        assert.ok(LogicalPath.validate({ kind: "global" }, "/my-template/readme.md").ok, "/my-template 是用户子目录，应放行");
    });

    it("project maps logical paths under project template prefix", () => {
        const scope = { kind: "project" as const, projectId: "p1" };
        assert.equal(unwrap(LogicalPath.toPhysical(scope, "/prompts/system.md")), "/projects/p1/template/prompts/system.md");
        assert.equal(unwrap(LogicalPath.toLogical(scope, "/projects/p1/template/prompts/system.md")), "/prompts/system.md");
    });

    it("global-meta：物理 = 逻辑原样（自带 /meta 段），scopeKey global:meta", () => {
        const scope = { kind: "global-meta" as const };
        assert.equal(unwrap(LogicalPath.toPhysical(scope, "/meta/skills/foo/SKILL.md")), "/meta/skills/foo/SKILL.md");
        assert.equal(unwrap(LogicalPath.toLogical(scope, "/meta/skills/foo/SKILL.md")), "/meta/skills/foo/SKILL.md");
        assert.equal(LogicalPath.scopeKey(scope), "global:meta");
        // 逻辑路径自带 /meta 段，挂载前缀为空串
        assert.equal(LogicalPath.scopePhysicalPrefix(scope), "");
    });

    it("project-meta：物理前缀 /projects/{pid}（逻辑自带 /meta 段），scopeKey project:{pid}:meta", () => {
        const scope = { kind: "project-meta" as const, projectId: "p1" };
        assert.equal(unwrap(LogicalPath.toPhysical(scope, "/meta/skills/foo/SKILL.md")), "/projects/p1/meta/skills/foo/SKILL.md");
        assert.equal(unwrap(LogicalPath.toLogical(scope, "/projects/p1/meta/skills/foo/SKILL.md")), "/meta/skills/foo/SKILL.md");
        assert.equal(unwrap(LogicalPath.toLogical(scope, "/projects/p1/meta")), "/meta");
        assert.equal(LogicalPath.scopeKey(scope), "project:p1:meta");
        // 逻辑路径自带 /meta 段，挂载前缀仅项目段
        assert.equal(LogicalPath.scopePhysicalPrefix(scope), "/projects/p1");
        // 不得误吃同项目 template / 隔壁项目 meta 前缀：越 scope 返回 Err（不再 throw）
        for (const physical of ["/projects/p1/template/a.md", "/projects/p2/meta/skills/a/SKILL.md"]) {
            const rejected = LogicalPath.toLogical(scope, physical);
            assert.ok(!rejected.ok, `越 scope 必须走 Err 分支：${physical}`);
            if (!rejected.ok) assert.ok(AppErrorOps.is(rejected.error, "VFS_INVALID_PATH"));
        }
    });

    it("脱敏规则剥离 meta 两域物理前缀（先具体后泛化）", () => {
        assert.equal(
            KnownPhysicalPrefixes.strip(
                "not found: /projects/p1/meta/skills/foo/SKILL.md",
            ),
            "not found: /skills/foo/SKILL.md",
        );
        assert.equal(
            KnownPhysicalPrefixes.strip("not found: /meta/skills/foo/SKILL.md"),
            "not found: /skills/foo/SKILL.md",
        );
        // 既有三域规则不回退
        assert.equal(
            KnownPhysicalPrefixes.strip(
                "not found: /projects/p1/template/a.md at /template/b.md",
            ),
            "not found: /a.md at /b.md",
        );
    });
});
