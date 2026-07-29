import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVfsService, isVfsError } from "@novel-master/core/vfs";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("DefaultVfsService (integration)", () => {
  // createVfsService 返回 InternalVfsService（scopeKey + 逻辑路径）
  const GLOBAL = "global";

  it("creates paths at version 1", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const written = await vfs.write(GLOBAL, "/new.txt", "hello");
    assert.equal(written.version, 1);
    const read = await vfs.read(GLOBAL, "/new.txt");
    assert.equal(read.content, "hello");
    assert.equal(read.version, 1);
  });

  it("writes with expected version", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/v.txt", "one");
    const first = await vfs.read(GLOBAL, "/v.txt");
    const updated = await vfs.write(GLOBAL, "/v.txt", "two", {
      expectedVersion: first.version,
    });
    assert.equal(updated.version, 2);
  });

  it("rejects stale expected version", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/stale.txt", "one");
    await vfs.write(GLOBAL, "/stale.txt", "two", { expectedVersion: 1 });
    await assert.rejects(
      () => vfs.write(GLOBAL, "/stale.txt", "three", { expectedVersion: 1 }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "CONFLICT"));
        return true;
      },
    );
    const read = await vfs.read(GLOBAL, "/stale.txt");
    assert.equal(read.content, "two");
    assert.equal(read.version, 2);
  });

  it("writes with versionCheck disabled", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/free.txt", "one");
    const updated = await vfs.write(GLOBAL, "/free.txt", "two", {
      versionCheck: false,
    });
    assert.equal(updated.version, 2);
  });

  it("replaces first occurrence and all occurrences", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/r.txt", "hello world");
    const once = await vfs.replace(GLOBAL, "/r.txt", "world", "there");
    assert.equal(once.replacements, 1);
    assert.equal((await vfs.read(GLOBAL, "/r.txt")).content, "hello there");

    await vfs.write(GLOBAL, "/all.txt", "a X b X");
    const all = await vfs.replace(GLOBAL, "/all.txt", "X", "Y", { replaceAll: true });
    assert.equal(all.replacements, 2);
    assert.equal((await vfs.read(GLOBAL, "/all.txt")).content, "a Y b Y");
  });

  it("fails replace when oldString is missing", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/missing.txt", "hello");
    await assert.rejects(
      () => vfs.replace(GLOBAL, "/missing.txt", "nope", "x"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "REPLACE_NOT_FOUND"));
        return true;
      },
    );
  });

  it("glob and grep", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/docs/a.md", "# A");
    await vfs.write(GLOBAL, "/docs/b.txt", "plain");
    const paths = await vfs.glob(GLOBAL, "**/*.md");
    assert.deepEqual(paths, ["/docs/a.md"]);
    const hits = await vfs.grep(GLOBAL, "#");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/docs/a.md");
    assert.equal(hits[0]!.line, 1);
  });

  it("grep with pathGlob filters by file pattern", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.write(GLOBAL, "/grep-glob/a.md", "# A");
    await vfs.write(GLOBAL, "/grep-glob/b.txt", "# B");
    const hits = await vfs.grep(GLOBAL, "#", { pathGlob: "/grep-glob/**/*.md" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/grep-glob/a.md");
    assert.equal(hits[0]!.line, 1);
  });

  it("空 storage root 目录 list 返回 [] 而非 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const vfs = createVfsService(ctx.conn);
    // 用独立的临时 scopeKey，避免与其他测试的 global 路径冲突
    const isolatedScope = `test:${testIsolationSuffix()}`;
    assert.deepEqual(await vfs.list(isolatedScope, "/"), []);
  });

  it("lists with recursive depth", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.mkdir(GLOBAL, "/a");
    await vfs.mkdir(GLOBAL, "/a/b");
    await vfs.write(GLOBAL, "/a/b/c", "c");
    assert.deepEqual(await vfs.list(GLOBAL, "/a"), [
      { path: "/a/b", kind: "directory" },
    ]);
    assert.deepEqual(
      await vfs.list(GLOBAL, "/a", { recursive: true, maxDepth: 2 }),
      [
        { path: "/a/b", kind: "directory" },
        { path: "/a/b/c", kind: "file" },
      ],
    );
  });

  it("deletes recursively", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    await vfs.mkdir(GLOBAL, "/del");
    await vfs.write(GLOBAL, "/del/child", "child");
    await vfs.delete(GLOBAL, "/del", { recursive: true });
    await assert.rejects(() => vfs.read(GLOBAL, "/del/child"), (e: unknown) => {
      assert.ok(isVfsError(e, "NOT_FOUND"));
      return true;
    });
  });
});
