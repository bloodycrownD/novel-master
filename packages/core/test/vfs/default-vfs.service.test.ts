import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core";
import { openVfsTestConnection } from "./helpers.js";

describe("DefaultVfsService (integration)", () => {
  it("creates paths at version 1", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    const written = await vfs.write("/new.txt", "hello");
    assert.equal(written.version, 1);
    const read = await vfs.read("/new.txt");
    assert.equal(read.content, "hello");
    assert.equal(read.version, 1);
    await conn.close();
  });

  it("writes with expected version", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/v.txt", "one");
    const first = await vfs.read("/v.txt");
    const updated = await vfs.write("/v.txt", "two", {
      expectedVersion: first.version,
    });
    assert.equal(updated.version, 2);
    await conn.close();
  });

  it("rejects stale expected version", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/stale.txt", "one");
    await vfs.write("/stale.txt", "two", { expectedVersion: 1 });
    await assert.rejects(
      () => vfs.write("/stale.txt", "three", { expectedVersion: 1 }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "CONFLICT"));
        return true;
      },
    );
    const read = await vfs.read("/stale.txt");
    assert.equal(read.content, "two");
    assert.equal(read.version, 2);
    await conn.close();
  });

  it("writes with versionCheck disabled", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/free.txt", "one");
    const updated = await vfs.write("/free.txt", "two", {
      versionCheck: false,
    });
    assert.equal(updated.version, 2);
    await conn.close();
  });

  it("replaces first occurrence and all occurrences", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/r.txt", "hello world");
    const once = await vfs.replace("/r.txt", "world", "there");
    assert.equal(once.replacements, 1);
    assert.equal((await vfs.read("/r.txt")).content, "hello there");

    await vfs.write("/all.txt", "a X b X");
    const all = await vfs.replace("/all.txt", "X", "Y", { replaceAll: true });
    assert.equal(all.replacements, 2);
    assert.equal((await vfs.read("/all.txt")).content, "a Y b Y");
    await conn.close();
  });

  it("fails replace when oldString is missing", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/missing.txt", "hello");
    await assert.rejects(
      () => vfs.replace("/missing.txt", "nope", "x"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "REPLACE_NOT_FOUND"));
        return true;
      },
    );
    await conn.close();
  });

  it("glob and grep", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/docs/a.md", "# A");
    await vfs.write("/docs/b.txt", "plain");
    const paths = await vfs.glob("**/*.md");
    assert.deepEqual(paths, ["/docs/a.md"]);
    const hits = await vfs.grep("#");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/docs/a.md");
    assert.equal(hits[0]!.line, 1);
    await conn.close();
  });

  it("lists with recursive depth", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/a");
    await vfs.mkdir("/a/b");
    await vfs.write("/a/b/c", "c");
    assert.deepEqual(await vfs.list("/a"), [
      { path: "/a/b", kind: "directory" },
    ]);
    assert.deepEqual(
      await vfs.list("/a", { recursive: true, maxDepth: 2 }),
      [
        { path: "/a/b", kind: "directory" },
        { path: "/a/b/c", kind: "file" },
      ],
    );
    await conn.close();
  });

  it("deletes recursively", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/del");
    await vfs.write("/del/child", "child");
    await vfs.delete("/del", { recursive: true });
    await assert.rejects(() => vfs.read("/del/child"), (e: unknown) => {
      assert.ok(isVfsError(e, "NOT_FOUND"));
      return true;
    });
    await conn.close();
  });
});
