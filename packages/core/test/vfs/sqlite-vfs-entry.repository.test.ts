import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VfsError } from "@/errors/vfs-errors.js";
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
      assert.ok(e instanceof VfsError);
      assert.equal(e.code, "INVALID_PATH");
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
    await conn.close();
  });

  it("lists direct children only by default", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insert("/a", "a");
    await repo.insert("/a/b", "b");
    await repo.insert("/a/b/c", "c");
    const shallow = await repo.list("/a");
    assert.deepEqual(shallow, ["/a/b"]);
    const recursive = await repo.list("/a", { recursive: true });
    assert.deepEqual(recursive, ["/a/b", "/a/b/c"]);
    const depth2 = await repo.list("/a", { recursive: true, maxDepth: 2 });
    assert.deepEqual(depth2, ["/a/b", "/a/b/c"]);
    const depth1 = await repo.list("/a", { recursive: true, maxDepth: 1 });
    assert.deepEqual(depth1, ["/a/b"]);
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
        assert.ok(e instanceof VfsError);
        assert.equal(e.code, "CONFLICT");
        assert.equal(e.actualVersion, 2);
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
    await repo.insert("/tree", "root");
    await repo.insert("/tree/leaf", "leaf");
    await assert.rejects(
      () => repo.delete("/tree", { recursive: false }),
      (e: unknown) => {
        assert.ok(e instanceof VfsError);
        assert.equal(e.code, "DIRECTORY_NOT_EMPTY");
        return true;
      },
    );
    await conn.close();
  });

  it("deletes recursively", async () => {
    const { conn } = await openVfsTestConnection();
    const repo = new SqliteVfsEntryRepository(conn);
    await repo.insert("/tree", "root");
    await repo.insert("/tree/leaf", "leaf");
    await repo.delete("/tree", { recursive: true });
    assert.equal(await repo.findByPath("/tree"), null);
    assert.equal(await repo.findByPath("/tree/leaf"), null);
    await conn.close();
  });
});
