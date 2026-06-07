import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core";
import { moveVfsPath, remapPathUnderDir } from "../../src/domain/vfs/logic/vfs-move.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("moveVfsPath", () => {
  it("moves a file and preserves content", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/old.md", "content");
    await moveVfsPath(vfs, "/old.md", "/new.md");

    const read = await vfs.read("/new.md");
    assert.equal(read.content, "content");
    await assert.rejects(
      () => vfs.read("/old.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
    await ctx.conn.close();
  });

  it("moves a directory tree", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/src");
    await vfs.mkdir("/src/sub");
    await vfs.write("/src/a.md", "a");
    await vfs.write("/src/sub/b.md", "b");

    await moveVfsPath(vfs, "/src", "/dst");

    assert.equal((await vfs.read("/dst/a.md")).content, "a");
    assert.equal((await vfs.read("/dst/sub/b.md")).content, "b");
    await assert.rejects(
      () => vfs.read("/src/a.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
    await ctx.conn.close();
  });

  it("fails with NOT_FOUND for missing path", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("p");
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await assert.rejects(
      () => moveVfsPath(vfs, "/missing", "/elsewhere"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
    await ctx.conn.close();
  });
});

describe("remapPathUnderDir", () => {
  it("remaps nested paths under a new directory root", () => {
    assert.equal(
      remapPathUnderDir("/src/sub/file.txt", "/src", "/dst"),
      "/dst/sub/file.txt",
    );
    assert.equal(remapPathUnderDir("/src", "/src", "/dst"), "/dst");
  });
});
