import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "@/errors/app-error.js";
import { vfsInvalidPath } from "@/errors/vfs-errors.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";

/** 把 Result 收成路径串：失败分支在测试里直接断言失败。 */
function unwrapPath(result: ReturnType<typeof normalizePath>): string {
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

/** 把「成功串 / 失败 message / 失败 path」收成可 deepEqual 的形状。 */
type PathOutcome = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string; readonly path: unknown };

function legacyOutcome(input: unknown): PathOutcome {
  try {
    return {ok: true, value: legacyNormalizePath(input as string)};
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return {ok: false, message: error.message, path: (error as { path?: unknown }).path};
  }
}

function resultOutcome(input: unknown): PathOutcome {
  const result = normalizePath(input as string);
  return result.ok ? {ok: true, value: result.value} : {ok: false, message: result.error.message, path: result.error.details?.path};
}

describe("normalizePath（Result 型）", () => {
  it("成功分支逐值等价：绝对 POSIX 形态、反斜杠转正、`.`/`..` 消化", () => {
    assert.equal(unwrapPath(normalizePath("/a/b")), "/a/b");
    assert.equal(unwrapPath(normalizePath("/a//b")), "/a/b");
    assert.equal(unwrapPath(normalizePath("/a\\b")), "/a/b");
    assert.equal(unwrapPath(normalizePath("/a/./b/../c/")), "/a/c");
    assert.equal(unwrapPath(normalizePath("/")), "/");
  });

  it("空串 → VFS_INVALID_PATH，message / details.path / messageKey 与原 VfsError 同口径", () => {
    const result = normalizePath("");
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

  it("非绝对路径与越根 → VFS_INVALID_PATH，返回而非抛出", () => {
    const relative = normalizePath("relative");
    assert.equal(relative.ok, false);
    if (!relative.ok) {
      assert.equal(relative.error.message, "Invalid path relative: path must start with /");
      assert.deepEqual(relative.error.details, { path: "relative" });
    }

    const escape = normalizePath("/../x");
    assert.equal(escape.ok, false);
    if (!escape.ok) {
      assert.equal(escape.error.message, "Invalid path /../x: path escapes above root");
      assert.deepEqual(escape.error.details, { path: "/../x" });
    }
  });

  it("与 HEAD 的 throw 型实现逐值等价：成功串、失败 message、失败 path 三项全同", () => {
    const corpus: unknown[] = ["", "   ", "a", "a/b", "a/../b", "/a/b", "/a//b", "/a/./b/../c/", "/", "///", "/..", "/../x", "/a/../../b", "/a\\b", "\\a\\b", "a\\b", undefined, null, 123];
    for (const input of corpus) {
      assert.deepEqual(resultOutcome(input), legacyOutcome(input), `输入 ${JSON.stringify(input)}`);
    }
  });
});
