import { isAppError } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVfsService } from "../../src/service/vfs/create-vfs-service.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";
import { rejectsErr, unwrap } from "../helpers/result-unwrap.js";


novelMasterTestFixture();

describe("DefaultVfsService (integration)", () => {
  // createVfsService 返回 InternalVfsService（scopeKey + 逻辑路径）
  const GLOBAL = "global";

  it("creates paths at version 1", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const written = unwrap(await vfs.write(GLOBAL, "/new.txt", "hello"));
    assert.equal(written.version, 1);
    const read = unwrap(await vfs.read(GLOBAL, "/new.txt"));
    assert.equal(read.content, "hello");
    assert.equal(read.version, 1);
  });

  it("writes with expected version", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.write(GLOBAL, "/v.txt", "one"));
    const first = unwrap(await vfs.read(GLOBAL, "/v.txt"));
    const updated = unwrap(await vfs.write(GLOBAL, "/v.txt", "two"));
    assert.equal(updated.version, first.version + 1);
  });

  it("stale expected version：版本比对已移除，不拒绝且覆盖成功", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.write(GLOBAL, "/stale.txt", "one"));
    unwrap(await vfs.write(GLOBAL, "/stale.txt", "two"));
    const updated = unwrap(await vfs.write(GLOBAL, "/stale.txt", "three"));
    assert.equal(updated.version, 3);
    const read = unwrap(await vfs.read(GLOBAL, "/stale.txt"));
    assert.equal(read.content, "three");
    assert.equal(read.version, 3);
  });

  it("replaces first occurrence and all occurrences", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.write(GLOBAL, "/r.txt", "hello world"));
    const once = unwrap(await vfs.replace(GLOBAL, "/r.txt", "world", "there"));
    assert.equal(once.replacements, 1);
    assert.equal(unwrap(await vfs.read(GLOBAL, "/r.txt")).content, "hello there");

    unwrap(await vfs.write(GLOBAL, "/all.txt", "a X b X"));
    const all = unwrap(await vfs.replace(GLOBAL, "/all.txt", "X", "Y", { replaceAll: true }));
    assert.equal(all.replacements, 2);
    assert.equal(unwrap(await vfs.read(GLOBAL, "/all.txt")).content, "a Y b Y");
  });

  it("fails replace when oldString is missing", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.write(GLOBAL, "/missing.txt", "hello"));
    await rejectsErr(() => vfs.replace(GLOBAL, "/missing.txt", "nope", "x"), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_REPLACE_NOT_FOUND"));
    });
  });

  it("glob and grep", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.write(GLOBAL, "/docs/a.md", "# A"));
    unwrap(await vfs.write(GLOBAL, "/docs/b.txt", "plain"));
    const paths = await vfs.glob(GLOBAL, "**/*.md");
    assert.deepEqual(paths, ["/docs/a.md"]);
    const hits = unwrap(await vfs.grep(GLOBAL, "#"));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/docs/a.md");
    assert.equal(hits[0]!.line, 1);
  });

  it("grep with pathGlob filters by file pattern", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.write(GLOBAL, "/grep-glob/a.md", "# A"));
    unwrap(await vfs.write(GLOBAL, "/grep-glob/b.txt", "# B"));
    const hits = unwrap(await vfs.grep(GLOBAL, "#", { pathGlob: "/grep-glob/**/*.md" }));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/grep-glob/a.md");
    assert.equal(hits[0]!.line, 1);
  });

  it("空 storage root 目录 list 返回 [] 而非 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    // 用独立的临时 scopeKey，避免与其他测试的 global 路径冲突
    const isolatedScope = `test:${testIsolationSuffix()}`;
    assert.deepEqual(unwrap(await vfs.list(isolatedScope, "/")), []);
  });

  it("lists with recursive depth", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.mkdir(GLOBAL, "/a"));
    unwrap(await vfs.mkdir(GLOBAL, "/a/b"));
    unwrap(await vfs.write(GLOBAL, "/a/b/c", "c"));
    assert.deepEqual(unwrap(await vfs.list(GLOBAL, "/a")), [
      { path: "/a/b", kind: "directory", version: 1 },
    ]);
    assert.deepEqual(
      unwrap(await vfs.list(GLOBAL, "/a", { recursive: true, maxDepth: 2 })),
      [
        { path: "/a/b", kind: "directory", version: 1 },
        { path: "/a/b/c", kind: "file", version: 1 },
      ],
    );
  });

  it("deletes recursively", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    unwrap(await vfs.mkdir(GLOBAL, "/del"));
    unwrap(await vfs.write(GLOBAL, "/del/child", "child"));
    unwrap(await vfs.delete(GLOBAL, "/del", { recursive: true }));
    await rejectsErr(() => vfs.read(GLOBAL, "/del/child"), (e: unknown) => {
      assert.ok(isAppError(e, "VFS_NOT_FOUND"));
    });
  });
});
