import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core/vfs";
import { moveVfsPath, remapPathUnderDir } from "../../src/domain/vfs/logic/vfs-move.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("moveVfsPath", () => {
  it("moves a file and preserves content", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
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
  });

  it("moves a directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
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
  });

  it("fails when target file already exists and keeps source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/a.md", "original-a");
    await vfs.write("/b.md", "original-b");

    await assert.rejects(
      () => moveVfsPath(vfs, "/b.md", "/a.md"),
      (e: unknown) => isVfsError(e, "ALREADY_EXISTS"),
    );
    assert.equal((await vfs.read("/a.md")).content, "original-a");
    assert.equal((await vfs.read("/b.md")).content, "original-b");
  });

  it("fails when target directory already exists", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/dirA");
    await vfs.write("/other.md", "stay");

    await assert.rejects(
      () => moveVfsPath(vfs, "/other.md", "/dirA"),
      (e: unknown) => isVfsError(e, "ALREADY_EXISTS"),
    );
    assert.equal((await vfs.read("/other.md")).content, "stay");
    await vfs.list("/dirA");
  });

  it("no-ops when from and to normalize to the same path", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/same.md", "content");
    await moveVfsPath(vfs, "/same.md", "/same.md");
    assert.equal((await vfs.read("/same.md")).content, "content");
  });

  it("fails with NOT_FOUND for missing path", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await assert.rejects(
      () => moveVfsPath(vfs, "/missing", "/elsewhere"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
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
