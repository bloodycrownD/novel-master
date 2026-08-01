import { createVfsService } from "@novel-master/core/vfs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@/errors/vfs-errors.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function isolatedRoot(): string {
  return `/${testIsolationSuffix()}`;
}

describe("normalizePath", () => {
  it("normalizes POSIX paths", () => {
    assert.equal(normalizePath("/a/b"), "/a/b");
    assert.equal(normalizePath("/a//b"), "/a/b");
    assert.equal(normalizePath("/"), "/");
  });

  it("rejects invalid paths", () => {
    assert.throws(() => normalizePath("relative"), (e: unknown) => {
      assert.ok(isVfsError(e, "INVALID_PATH"));
      return true;
    });
  });
});

describe("SqliteVfsEntryRepository", () => {
  const GLOBAL_SCOPE = "global";

  it("inserts and reads entries", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const path = `${isolatedRoot()}/hello.txt`;
    await repo.insert(GLOBAL_SCOPE, path, "hi");
    const entry = await repo.findByPath(GLOBAL_SCOPE, path);
    assert.ok(entry);
    assert.equal(entry.content, "hi");
    assert.equal(entry.version, 1);
    assert.equal(entry.entryKind, "file");
  });

  it("lists direct children only by default", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const a = `${root}/a`;
    await repo.insertDirectory(GLOBAL_SCOPE, a);
    await repo.insertDirectory(GLOBAL_SCOPE, `${a}/b`);
    await repo.insert(GLOBAL_SCOPE, `${a}/b/c`, "c");
    const shallow = await repo.list(GLOBAL_SCOPE, a);
    assert.deepEqual(shallow, [
      { path: `${a}/b`, kind: "directory", version: 1 },
    ]);
    const recursive = await repo.list(GLOBAL_SCOPE, a, { recursive: true });
    assert.deepEqual(recursive, [
      { path: `${a}/b`, kind: "directory", version: 1 },
      { path: `${a}/b/c`, kind: "file", version: 1 },
    ]);
    const depth2 = await repo.list(GLOBAL_SCOPE, a, { recursive: true, maxDepth: 2 });
    assert.deepEqual(depth2, [
      { path: `${a}/b`, kind: "directory", version: 1 },
      { path: `${a}/b/c`, kind: "file", version: 1 },
    ]);
    const depth1 = await repo.list(GLOBAL_SCOPE, a, { recursive: true, maxDepth: 1 });
    assert.deepEqual(depth1, [
      { path: `${a}/b`, kind: "directory", version: 1 },
    ]);
  });

  it("list 将路径中的 % 按字面量匹配（非递归）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const draftDir = `${root}/x/v1%draft`;
    const wrongDir = `${root}/x/v1Xdraft`;
    await repo.insertDirectory(GLOBAL_SCOPE, draftDir);
    await repo.insert(GLOBAL_SCOPE, `${draftDir}/keep.txt`, "keep");
    await repo.insertDirectory(GLOBAL_SCOPE, wrongDir);
    await repo.insert(GLOBAL_SCOPE, `${wrongDir}/wrong.txt`, "wrong");

    const shallow = await repo.list(GLOBAL_SCOPE, draftDir);
    assert.deepEqual(shallow, [
      { path: `${draftDir}/keep.txt`, kind: "file", version: 1 },
    ]);
  });

  it("list 将路径中的 % 按字面量匹配（递归）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const draftDir = `${root}/x/v1%draft`;
    const wrongDir = `${root}/x/v1Xdraft`;
    await repo.insertDirectory(GLOBAL_SCOPE, draftDir);
    await repo.insert(GLOBAL_SCOPE, `${draftDir}/keep.txt`, "keep");
    await repo.insertDirectory(GLOBAL_SCOPE, `${draftDir}/nested`);
    await repo.insert(GLOBAL_SCOPE, `${draftDir}/nested/deep.txt`, "deep");
    await repo.insertDirectory(GLOBAL_SCOPE, wrongDir);
    await repo.insert(GLOBAL_SCOPE, `${wrongDir}/wrong.txt`, "wrong");

    const recursive = await repo.list(GLOBAL_SCOPE, draftDir, { recursive: true });
    assert.deepEqual(
      recursive.map((e) => e.path).sort(),
      [
        `${draftDir}/keep.txt`,
        `${draftDir}/nested`,
        `${draftDir}/nested/deep.txt`,
      ].sort(),
    );
  });

  it("list 将路径中的 _ 按字面量匹配（非递归）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const barDir = `${root}/x/foo_bar`;
    const wrongPath = `${root}/x/fooXbar/wrong.txt`;
    await repo.insertDirectory(GLOBAL_SCOPE, barDir);
    await repo.insert(GLOBAL_SCOPE, `${barDir}/ok.txt`, "ok");
    await repo.insertDirectory(GLOBAL_SCOPE, `${root}/x/fooXbar`);
    await repo.insert(GLOBAL_SCOPE, wrongPath, "wrong");

    const shallow = await repo.list(GLOBAL_SCOPE, barDir);
    assert.deepEqual(shallow, [
      { path: `${barDir}/ok.txt`, kind: "file", version: 1 },
    ]);
  });

  it("detects version conflicts", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const path = `${isolatedRoot()}/v.txt`;
    await repo.insert(GLOBAL_SCOPE, path, "one");
    await repo.update(GLOBAL_SCOPE, path, "two", { expectedVersion: 1, versionCheck: true });
    await assert.rejects(
      () =>
        repo.update(GLOBAL_SCOPE, path, "three", {
          expectedVersion: 1,
          versionCheck: true,
        }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "CONFLICT"));
        assert.equal((e as { actualVersion?: number }).actualVersion, 2);
        return true;
      },
    );
  });

  it("updates without version check", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const path = `${isolatedRoot()}/nc.txt`;
    await repo.insert(GLOBAL_SCOPE, path, "one");
    const result = await repo.update(GLOBAL_SCOPE, path, "two", { versionCheck: false });
    assert.equal(result.version, 2);
  });

  it("blocks non-recursive delete when children exist", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const tree = `${isolatedRoot()}/tree`;
    await repo.insertDirectory(GLOBAL_SCOPE, tree);
    await repo.insert(GLOBAL_SCOPE, `${tree}/leaf`, "leaf");
    await assert.rejects(
      () => repo.delete(GLOBAL_SCOPE, tree, { recursive: false }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "DIRECTORY_NOT_EMPTY"));
        return true;
      },
    );
  });

  it("deletes recursively", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const tree = `${isolatedRoot()}/tree`;
    await repo.insertDirectory(GLOBAL_SCOPE, tree);
    await repo.insert(GLOBAL_SCOPE, `${tree}/leaf`, "leaf");
    await repo.delete(GLOBAL_SCOPE, tree, { recursive: true });
    assert.equal(await repo.findByPath(GLOBAL_SCOPE, tree), null);
    assert.equal(await repo.findByPath(GLOBAL_SCOPE, `${tree}/leaf`), null);
  });

  it("跨 scope 隔离：同 path 在不同 scope 各自独立读写删", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const scopeA = `session:projA:sessA`;
    const scopeB = `session:projA:sessB`;
    const root = isolatedRoot();
    const path = `${root}/foo.md`;

    // 两个 scope 各 insert 同 path、不同内容。
    await repo.insert(scopeA, path, "content-A");
    await repo.insert(scopeB, path, "content-B");

    // findByPath 按 scope 取各自的版本。
    const a = await repo.findByPath(scopeA, path);
    const b = await repo.findByPath(scopeB, path);
    assert.ok(a);
    assert.ok(b);
    assert.equal(a!.content, "content-A");
    assert.equal(b!.content, "content-B");
    // 注意：entry_id 是全局唯一身份键，两个 scope 的同一 path 不应共享同一个 entry_id。
    assert.notEqual(a!.entryId, b!.entryId);

    // 对 scopeA 做 update 不影响 scopeB。
    await repo.update(scopeA, path, "content-A2", { versionCheck: false });
    assert.equal((await repo.findByPath(scopeA, path))!.content, "content-A2");
    assert.equal((await repo.findByPath(scopeB, path))!.content, "content-B");

    // listAllPaths / listFileHeadsUnderPrefix / listFileMetaUnderPrefix 的 scope 隔离。
    assert.deepEqual(await repo.listAllPaths(scopeA), [path]);
    await repo.insertDirectory(scopeA, `${root}/otherA`);
    const headsA = await repo.listFileHeadsUnderPrefix(scopeA, root);
    assert.ok(headsA.some((h) => h.path === path));
    const headsB = await repo.listFileHeadsUnderPrefix(scopeB, root);
    assert.ok(headsB.some((h) => h.path === path));
    assert.deepEqual(
      (await repo.listFileMetaUnderPrefix(scopeA, root)).map((m) => m.path).sort(),
      [path].sort(),
    );
    assert.deepEqual(
      (await repo.listFileMetaUnderPrefix(scopeB, root)).map((m) => m.path).sort(),
      [path].sort(),
    );

    // 删除 scopeA 不影响 scopeB。
    await repo.delete(scopeA, path, { recursive: false });
    assert.equal(await repo.findByPath(scopeA, path), null);
    assert.equal((await repo.findByPath(scopeB, path))!.content, "content-B");
  });

  it("listFileMetaUnderPrefix returns path and mtime without content", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const aTxt = `${root}/a.txt`;
    const dir = `${root}/dir`;
    await repo.insert(GLOBAL_SCOPE, aTxt, "alpha");
    await repo.insert(GLOBAL_SCOPE, `${dir}/b.txt`, "beta");
    await repo.insertDirectory(GLOBAL_SCOPE, dir);

    const meta = await repo.listFileMetaUnderPrefix(GLOBAL_SCOPE, root);
    assert.equal(meta.length, 2);
    assert.deepEqual(
      meta.map((row) => row.path).sort(),
      [aTxt, `${dir}/b.txt`],
    );
    for (const row of meta) {
      assert.equal(typeof row.mtimeMs, "number");
      assert.ok(row.mtimeMs > 0);
      assert.equal("content" in row, false);
    }
  });
});
