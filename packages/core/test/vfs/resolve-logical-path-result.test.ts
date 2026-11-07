import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "@/errors/app-error.js";
import { vfsInvalidPath } from "@/errors/vfs-errors.js";
import { assertLogicalPathAllowed, resolveLogicalPath, toLogicalPath, toPhysicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 把 Result 收成路径串：失败分支在测试里直接断言失败。 */
function unwrapPath(result: ReturnType<typeof resolveLogicalPath>): string {
  return result.ok ? result.value : assert.fail(`意外失败：${result.error.message}`);
}

/** HEAD 的 throw 型 normalizePath（原样转录自 `git show HEAD:.../normalize-path.ts`），仅作逐值等价对照。 */
function legacyNormalizePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw vfsInvalidPath(String(path), "path must be a non-empty string");
  }
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    throw vfsInvalidPath(path, "path must start with /");
  }
  const stack: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        throw vfsInvalidPath(path, "path escapes above root");
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.length === 0 ? "/" : `/${stack.join("/")}`;
}

/** HEAD 的 throw 型 resolveLogicalPath（原样转录自 `git show HEAD:.../vfs-path-mapper.ts`），仅作对照。 */
function legacyResolveLogicalPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw vfsInvalidPath(String(input), "path must be a non-empty string");
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
    return {ok: false, message: error.message, path: (error as { path?: unknown }).path};
  }
}

function resultOutcome(input: string): PathOutcome {
  const result = resolveLogicalPath(input);
  return result.ok ? {ok: true, value: result.value} : {ok: false, message: result.error.message, path: result.error.details?.path};
}

describe("resolveLogicalPath（Result 型）", () => {
  it("成功分支逐值等价：相对/绝对/反斜杠与 `.`/`..` 消化的输出串与原实现一致", () => {
    assert.equal(unwrapPath(resolveLogicalPath("notes/a.md")), "/notes/a.md");
    assert.equal(unwrapPath(resolveLogicalPath("/notes/a.md")), "/notes/a.md");
    assert.equal(unwrapPath(resolveLogicalPath("  notes/a.md  ")), "/notes/a.md");
    assert.equal(unwrapPath(resolveLogicalPath("notes//a/./b/../c.md")), "/notes/a/c.md");
    assert.equal(unwrapPath(resolveLogicalPath("notes\\a.md")), "/notes/a.md");
    assert.equal(unwrapPath(resolveLogicalPath("/")), "/");
  });

  it("空输入 → VFS_INVALID_PATH，message/path 与原 VfsError 同口径，且不再抛出", () => {
    const result = resolveLogicalPath("");
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.ok(isAppError(result.error, "VFS_INVALID_PATH"));
    assert.equal(result.error.name, "VFS_INVALID_PATH");
    assert.equal(result.error.code, 102004);
    assert.equal(result.error.desc, "invalid vfs path");
    assert.equal(result.error.message, "Invalid path : path must be a non-empty string");
    assert.deepEqual(result.error.details, { path: "" });
    assert.equal(result.error.messageKey, undefined);
  });

  it("规范化失败（越根）→ 透传 normalizePath 的 VFS_INVALID_PATH，路径串含此前补的 leading `/`", () => {
    const result = resolveLogicalPath("a/../../b");
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.key, "VFS_INVALID_PATH");
    assert.equal(result.error.message, "Invalid path /a/../../b: path escapes above root");
    assert.deepEqual(result.error.details, { path: "/a/../../b" });
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

describe("vfs-path-mapper 同文件 throw 型兄弟函数（Result 解包后透传）", () => {
  it("assertLogicalPathAllowed：非法路径仍在原时机抛出，message 与旧 VfsError 同口径", () => {
    const legacy = legacyOutcome("   ");
    const expected = legacy.ok ? "" : legacy.message;
    assert.throws(
      () => assertLogicalPathAllowed({ kind: "global" }, "   "),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, expected);
        return true;
      },
    );
  });

  it("toPhysicalPath：非法路径抛出且不产出物理路径；合法路径映射不变", () => {
    assert.throws(() => toPhysicalPath({ kind: "global" }, "a/../../b"), /Invalid path \/a\/\.\.\/\.\.\/b: path escapes above root/);
    assert.equal(toPhysicalPath({ kind: "project", projectId: "p1" }, "/prompts/system.md"), "/projects/p1/template/prompts/system.md");
  });

  it("toLogicalPath：物理路径非法时抛出，越 scope 仍按旧时机抛错", () => {
    assert.throws(() => toLogicalPath({ kind: "global" }, ""), /Invalid path : path must be a non-empty string/);
    assert.throws(() => toLogicalPath({ kind: "project", projectId: "p1" }, "/projects/p2/template/a.md"), /not in project template scope/);
    assert.equal(toLogicalPath({ kind: "global" }, "/template/seed/hello.md"), "/seed/hello.md");
  });
});
