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
  it("inserts and reads entries", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const path = `${isolatedRoot()}/hello.txt`;
    await repo.insert(path, "hi");
    const entry = await repo.findByPath(path);
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
    await repo.insertDirectory(a);
    await repo.insertDirectory(`${a}/b`);
    await repo.insert(`${a}/b/c`, "c");
    const shallow = await repo.list(a);
    assert.deepEqual(shallow, [{ path: `${a}/b`, kind: "directory" }]);
    const recursive = await repo.list(a, { recursive: true });
    assert.deepEqual(recursive, [
      { path: `${a}/b`, kind: "directory" },
      { path: `${a}/b/c`, kind: "file" },
    ]);
    const depth2 = await repo.list(a, { recursive: true, maxDepth: 2 });
    assert.deepEqual(depth2, [
      { path: `${a}/b`, kind: "directory" },
      { path: `${a}/b/c`, kind: "file" },
    ]);
    const depth1 = await repo.list(a, { recursive: true, maxDepth: 1 });
    assert.deepEqual(depth1, [{ path: `${a}/b`, kind: "directory" }]);
  });

  it("list 将路径中的 % 按字面量匹配（非递归）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const draftDir = `${root}/x/v1%draft`;
    const wrongDir = `${root}/x/v1Xdraft`;
    await repo.insertDirectory(draftDir);
    await repo.insert(`${draftDir}/keep.txt`, "keep");
    await repo.insertDirectory(wrongDir);
    await repo.insert(`${wrongDir}/wrong.txt`, "wrong");

    const shallow = await repo.list(draftDir);
    assert.deepEqual(shallow, [{ path: `${draftDir}/keep.txt`, kind: "file" }]);
  });

  it("list 将路径中的 % 按字面量匹配（递归）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const draftDir = `${root}/x/v1%draft`;
    const wrongDir = `${root}/x/v1Xdraft`;
    await repo.insertDirectory(draftDir);
    await repo.insert(`${draftDir}/keep.txt`, "keep");
    await repo.insertDirectory(`${draftDir}/nested`);
    await repo.insert(`${draftDir}/nested/deep.txt`, "deep");
    await repo.insertDirectory(wrongDir);
    await repo.insert(`${wrongDir}/wrong.txt`, "wrong");

    const recursive = await repo.list(draftDir, { recursive: true });
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
    await repo.insertDirectory(barDir);
    await repo.insert(`${barDir}/ok.txt`, "ok");
    await repo.insertDirectory(`${root}/x/fooXbar`);
    await repo.insert(wrongPath, "wrong");

    const shallow = await repo.list(barDir);
    assert.deepEqual(shallow, [{ path: `${barDir}/ok.txt`, kind: "file" }]);
  });

  it("detects version conflicts", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const path = `${isolatedRoot()}/v.txt`;
    await repo.insert(path, "one");
    await repo.update(path, "two", { expectedVersion: 1, versionCheck: true });
    await assert.rejects(
      () =>
        repo.update(path, "three", {
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
    await repo.insert(path, "one");
    const result = await repo.update(path, "two", { versionCheck: false });
    assert.equal(result.version, 2);
  });

  it("blocks non-recursive delete when children exist", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const tree = `${isolatedRoot()}/tree`;
    await repo.insertDirectory(tree);
    await repo.insert(`${tree}/leaf`, "leaf");
    await assert.rejects(
      () => repo.delete(tree, { recursive: false }),
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
    await repo.insertDirectory(tree);
    await repo.insert(`${tree}/leaf`, "leaf");
    await repo.delete(tree, { recursive: true });
    assert.equal(await repo.findByPath(tree), null);
    assert.equal(await repo.findByPath(`${tree}/leaf`), null);
  });

  it("listFileMetaUnderPrefix returns path and mtime without content", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteVfsEntryRepository(ctx.conn);
    const root = isolatedRoot();
    const aTxt = `${root}/a.txt`;
    const dir = `${root}/dir`;
    await repo.insert(aTxt, "alpha");
    await repo.insert(`${dir}/b.txt`, "beta");
    await repo.insertDirectory(dir);

    const meta = await repo.listFileMetaUnderPrefix(root);
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
