import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  AppError, AppErrorOps  } from "@/errors/app-error.js";
import {  LogicalPath  } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 把 Result 收成路径串：失败分支在测试里直接断言失败。 */
function unwrapPath(result: ReturnType<typeof LogicalPath.resolve>): string {
    return result.ok ? result.value : assert.fail(`意外失败：${result.error.message}`);
}

/** HEAD 的 throw 型 PathNormalizer.normalize（原样转录自 `git show HEAD:.../normalize-path.ts`），仅作逐值等价对照。 */
function legacyNormalizePath(path: string): string {
    if (typeof path !== "string" || path.length === 0) {
        throw new AppError("VFS_INVALID_PATH", {path: String(path), reason: "path must be a non-empty string", detail: `Invalid path ${String(path)}: path must be a non-empty string`});
    }
    const normalized = path.replace(/\\/g, "/");
    if (!normalized.startsWith("/")) {
        throw new AppError("VFS_INVALID_PATH", {path: path, reason: "path must start with /", detail: `Invalid path ${path}: path must start with /`});
    }
    const stack: string[] = [];
    for (const segment of normalized.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            if (stack.length === 0) {
                throw new AppError("VFS_INVALID_PATH", {path: path, reason: "path escapes above root", detail: `Invalid path ${path}: path escapes above root`});
            }
            stack.pop();
            continue;
        }
        stack.push(segment);
    }
    return stack.length === 0 ? "/" : `/${stack.join("/")}`;
}

/** HEAD 的 throw 型 LogicalPath.resolve（原样转录自 `git show HEAD:.../vfs-path-mapper.ts`），仅作对照。 */
function legacyResolveLogicalPath(input: string): string {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
        throw new AppError("VFS_INVALID_PATH", {path: String(input), reason: "path must be a non-empty string", detail: `Invalid path ${String(input)}: path must be a non-empty string`});
    }
    return legacyNormalizePath(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

/** 把「成功串 / 失败 message / 失败 path」收成可 deepEqual 的形状。 */
type PathOutcome = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string; readonly path: unknown };

function legacyOutcome(input: string): PathOutcome {
    try {
        return {ok: true, value: legacyResolveLogicalPath(input)};
    } catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }
        return {ok: false, message: error.message, path: (error as { details?: { path?: unknown } }).details?.path};
    }
}

function resultOutcome(input: string): PathOutcome {
    const result = LogicalPath.resolve(input);
    return result.ok ? {ok: true, value: result.value} : {ok: false, message: result.error.message, path: result.error.details?.path};
}

describe("LogicalPath.resolve（Result 型）", () => {
    it("成功分支逐值等价：相对/绝对/反斜杠与 `.`/`..` 消化的输出串与原实现一致", () => {
        assert.equal(unwrapPath(LogicalPath.resolve("notes/a.md")), "/notes/a.md");
        assert.equal(unwrapPath(LogicalPath.resolve("/notes/a.md")), "/notes/a.md");
        assert.equal(unwrapPath(LogicalPath.resolve("  notes/a.md  ")), "/notes/a.md");
        assert.equal(unwrapPath(LogicalPath.resolve("notes//a/./b/../c.md")), "/notes/a/c.md");
        assert.equal(unwrapPath(LogicalPath.resolve("notes\\a.md")), "/notes/a.md");
        assert.equal(unwrapPath(LogicalPath.resolve("/")), "/");
    });

    it("空输入 → VFS_INVALID_PATH，message/path 与原 VfsError 同口径，且不再抛出", () => {
        const result = LogicalPath.resolve("");
        assert.equal(result.ok, false);
        if (result.ok) {
            return;
        }
        assert.ok(AppErrorOps.is(result.error, "VFS_INVALID_PATH"));
        assert.equal(result.error.name, "VFS_INVALID_PATH");
        assert.equal(result.error.code, 102004);
        assert.equal(result.error.desc, "invalid vfs path");
        assert.equal(result.error.message, "Invalid path : path must be a non-empty string");
        assert.deepEqual(result.error.details, { path: "", detail: "Invalid path : path must be a non-empty string" });
        assert.equal(result.error.messageKey, undefined);
    });

    it("规范化失败（越根）→ 透传 PathNormalizer.normalize 的 VFS_INVALID_PATH，路径串含此前补的 leading `/`", () => {
        const result = LogicalPath.resolve("a/../../b");
        assert.equal(result.ok, false);
        if (result.ok) {
            return;
        }
        assert.equal(result.error.key, "VFS_INVALID_PATH");
        assert.equal(result.error.message, "Invalid path /a/../../b: path escapes above root");
        assert.deepEqual(result.error.details, { path: "/a/../../b", detail: "Invalid path /a/../../b: path escapes above root" });
    });

    it("与 HEAD 的 throw 型实现逐值等价：成功串、失败 message、失败 path 三项全同", () => {
        const corpus = [
            "",
            "   ",
            "\t\n",
            ".",
            "..",
            "./a",
            "notes/a.md",
            "/notes/a.md",
            "  notes/a.md  ",
            "notes//a/./b/../c.md",
            "notes\\a.md",
            "\\notes\\a.md",
            "/",
            "///",
            "/notes/",
            "notes/",
            "/../x",
            "a/../../b",
            "a/../..",
            "/a/b/../../../c",
            "C:\\foo\\bar",
        ];
        for (const input of corpus) {
            assert.deepEqual(resultOutcome(input), legacyOutcome(input), `输入 ${JSON.stringify(input)}`);
        }
    });
});

describe("vfs-path-mapper 同文件 throw 型兄弟函数（错误通道迁移二期：全部并入 Result 通道）", () => {
    it("LogicalPath.validate：非法路径返回 VFS_INVALID_PATH，message 与旧 VfsError 同口径", () => {
        const legacy = legacyOutcome("   ");
        const expected = legacy.ok ? "" : legacy.message;
        const result = LogicalPath.validate({ kind: "global" }, "   ");
        assert.ok(!result.ok, "非法路径必须走 Err 分支（不再 throw）");
        if (!result.ok) {
            assert.equal(result.error.key, "VFS_INVALID_PATH");
            assert.equal(result.error.message, expected);
        }
    });

    it("LogicalPath.toPhysical：非法路径返回 Err 且不产出物理路径；合法路径映射不变", () => {
        const invalid = LogicalPath.toPhysical({ kind: "global" }, "a/../../b");
        assert.ok(!invalid.ok, "非法路径必须走 Err 分支");
        if (!invalid.ok) {
            assert.equal(invalid.error.key, "VFS_INVALID_PATH");
            assert.match(invalid.error.message, /Invalid path \/a\/\.\.\/\.\.\/b: path escapes above root/);
        }
        const valid = LogicalPath.toPhysical({ kind: "project", projectId: "p1" }, "/prompts/system.md");
        assert.ok(valid.ok);
        if (valid.ok) assert.equal(valid.value, "/projects/p1/template/prompts/system.md");
    });

    it("LogicalPath.toLogical：物理路径非法时返回 Err，越 scope 仍按旧口径拒绝", () => {
        const empty = LogicalPath.toLogical({ kind: "global" }, "");
        assert.ok(!empty.ok);
        if (!empty.ok) assert.match(empty.error.message, /Invalid path : path must be a non-empty string/);
        const cross = LogicalPath.toLogical({ kind: "project", projectId: "p1" }, "/projects/p2/template/a.md");
        assert.ok(!cross.ok);
        if (!cross.ok) assert.match(cross.error.message, /not in project template scope/);
        const valid = LogicalPath.toLogical({ kind: "global" }, "/template/seed/hello.md");
        assert.ok(valid.ok);
        if (valid.ok) assert.equal(valid.value, "/seed/hello.md");
    });
});
