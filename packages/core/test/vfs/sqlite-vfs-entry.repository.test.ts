import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@/errors/vfs-errors.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { openVfsTestConnection } from "./helpers.js";

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
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insert("/hello.txt", "hi");
    const entry = await repo.findByPath("/hello.txt");
    assert.ok(entry);
    assert.equal(entry.content, "hi");
    assert.equal(entry.version, 1);
    assert.equal(entry.entryKind, "file");
    await conn.close();
  });

  it("lists direct children only by default", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insertDirectory("/a");
    await repo.insertDirectory("/a/b");
    await repo.insert("/a/b/c", "c");
    const shallow = await repo.list("/a");
    assert.deepEqual(shallow, [{ path: "/a/b", kind: "directory" }]);
    const recursive = await repo.list("/a", { recursive: true });
    assert.deepEqual(recursive, [
      { path: "/a/b", kind: "directory" },
      { path: "/a/b/c", kind: "file" },
    ]);
    const depth2 = await repo.list("/a", { recursive: true, maxDepth: 2 });
    assert.deepEqual(depth2, [
      { path: "/a/b", kind: "directory" },
      { path: "/a/b/c", kind: "file" },
    ]);
    const depth1 = await repo.list("/a", { recursive: true, maxDepth: 1 });
    assert.deepEqual(depth1, [{ path: "/a/b", kind: "directory" }]);
    await conn.close();
  });

  it("detects version conflicts", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insert("/v.txt", "one");
    await repo.update("/v.txt", "two", { expectedVersion: 1, versionCheck: true });
    await assert.rejects(
      () =>
        repo.update("/v.txt", "three", {
          expectedVersion: 1,
          versionCheck: true,
        }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "CONFLICT"));
        assert.equal((e as { actualVersion?: number }).actualVersion, 2);
        return true;
      },
    );
    await conn.close();
  });

  it("updates without version check", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insert("/nc.txt", "one");
    const result = await repo.update("/nc.txt", "two", { versionCheck: false });
    assert.equal(result.version, 2);
    await conn.close();
  });

  it("blocks non-recursive delete when children exist", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insertDirectory("/tree");
    await repo.insert("/tree/leaf", "leaf");
    await assert.rejects(
      () => repo.delete("/tree", { recursive: false }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "DIRECTORY_NOT_EMPTY"));
        return true;
      },
    );
    await conn.close();
  });

  it("deletes recursively", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insertDirectory("/tree");
    await repo.insert("/tree/leaf", "leaf");
    await repo.delete("/tree", { recursive: true });
    assert.equal(await repo.findByPath("/tree"), null);
    assert.equal(await repo.findByPath("/tree/leaf"), null);
    await conn.close();
  });

  it("listFileMetaUnderPrefix returns path and mtime without content", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insert("/a.txt", "alpha");
    await repo.insert("/dir/b.txt", "beta");
    await repo.insertDirectory("/dir");

    const meta = await repo.listFileMetaUnderPrefix("/");
    assert.equal(meta.length, 2);
    assert.deepEqual(
      meta.map((row) => row.path).sort(),
      ["/a.txt", "/dir/b.txt"],
    );
    for (const row of meta) {
      assert.equal(typeof row.mtimeMs, "number");
      assert.ok(row.mtimeMs > 0);
      assert.equal("content" in row, false);
    }
    await conn.close();
  });
});
