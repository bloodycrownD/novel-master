import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorktreeService, isVfsError } from "@novel-master/core";
import { openVfsTestConnection } from "./helpers.js";

describe("VFS directory nodes", () => {
  it("mkdir creates empty directory visible in list", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/drafts");
    const root = await vfs.list("/");
    assert.deepEqual(root, [{ path: "/drafts", kind: "directory" }]);
    assert.deepEqual(await vfs.list("/drafts"), []);
    const paths = await vfs.glob("**/.keep");
    assert.equal(paths.length, 0);
    await conn.close();
  });

  it("delete empty directory and reject non-empty without recursive", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/drafts");
    await vfs.delete("/drafts");
    assert.deepEqual(await vfs.list("/"), []);

    await vfs.mkdir("/drafts");
    await vfs.write("/drafts/a.md", "x", { versionCheck: false });
    await assert.rejects(
      () => vfs.delete("/drafts"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "DIRECTORY_NOT_EMPTY"));
        return true;
      },
    );
    await vfs.delete("/drafts", { recursive: true });
    assert.deepEqual(await vfs.list("/"), []);
    await conn.close();
  });

  it("read/write/replace fail on directory paths", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/drafts");
    for (const fn of [
      () => vfs.read("/drafts"),
      () => vfs.write("/drafts", "x", { versionCheck: false }),
      () => vfs.replace("/drafts", "a", "b"),
    ]) {
      await assert.rejects(fn, (e: unknown) => {
        assert.ok(isVfsError(e, "IS_DIRECTORY"));
        return true;
      });
    }
    await conn.close();
  });

  it("write ensures parent directory chain", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/drafts/a.md", "hi", { versionCheck: false });
    const root = await vfs.list("/");
    assert.ok(root.some((e) => e.path === "/drafts" && e.kind === "directory"));
    await conn.close();
  });

  it("update write does not recreate deleted parent directory rows", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/drafts/a.md", "hi", { versionCheck: false });
    await conn.execute(
      `DELETE FROM vfs_entry WHERE path = '/drafts' AND entry_kind = 'directory'`,
      [],
    );
    await vfs.write("/drafts/a.md", "updated", { versionCheck: false });
    const root = await vfs.list("/");
    assert.ok(!root.some((e) => e.path === "/drafts" && e.kind === "directory"));
    assert.equal((await vfs.read("/drafts/a.md")).content, "updated");
    await conn.close();
  });

  it("mkdir fails when parent path is a file row", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/parent-file", "content", { versionCheck: false });
    await assert.rejects(
      () => vfs.mkdir("/parent-file/child"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "NOT_A_DIRECTORY"));
        return true;
      },
    );
    await conn.close();
  });

  it("mkdir requires existing parent", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await assert.rejects(
      () => vfs.mkdir("/nested/leaf"),
      (e: unknown) => {
        assert.ok(isVfsError(e, "PARENT_NOT_FOUND"));
        return true;
      },
    );
    await conn.close();
  });

  it("grep skips directory rows; glob skips directory paths", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/dir");
    await vfs.write("/dir/.keep", "placeholder", { versionCheck: false });
    const hits = await vfs.grep("placeholder");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/dir/.keep");
    const paths = await vfs.glob("**/*");
    assert.ok(!paths.includes("/dir"));
    assert.ok(paths.includes("/dir/.keep"));
    await conn.close();
  });

  it("worktree buildListRows shows explicit empty directory", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.mkdir("/template");
    await vfs.mkdir("/template/empty");
    const wt = createWorktreeService(conn, { kind: "global" });
    const rows = await wt.buildListRows();
    assert.ok(
      rows.some((r) => r.kind === "dir" && r.path === "/empty"),
    );
    await conn.close();
  });
});
