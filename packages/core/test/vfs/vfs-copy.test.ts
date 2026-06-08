import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core";
import { copyVfsPath } from "../../src/domain/vfs/logic/vfs-copy.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("copyVfsPath", () => {
  it("copies a file without deleting the source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/a.txt", "hello");
    await copyVfsPath(vfs, "/a.txt", "/b.txt");

    assert.equal((await vfs.read("/a.txt")).content, "hello");
    assert.equal((await vfs.read("/b.txt")).content, "hello");
  });

  it("copies a directory tree when recursive is true", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/src");
    await vfs.write("/src/x.md", "x");

    await copyVfsPath(vfs, "/src", "/dst", { recursive: true });

    assert.equal((await vfs.read("/src/x.md")).content, "x");
    assert.equal((await vfs.read("/dst/x.md")).content, "x");
  });

  it("fails to copy a directory without recursive", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/src");
    await vfs.write("/src/x.md", "x");

    await assert.rejects(
      () => copyVfsPath(vfs, "/src", "/dst"),
      (e: unknown) => isVfsError(e, "IS_DIRECTORY"),
    );
    assert.equal((await vfs.read("/src/x.md")).content, "x");
    await assert.rejects(
      () => vfs.read("/dst/x.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });
});
