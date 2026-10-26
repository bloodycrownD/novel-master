import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVfsError } from "@novel-master/core/vfs";
import { copyVfsPath } from "../../src/domain/vfs/logic/vfs-copy.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function assertOk(result: { readonly ok: boolean }): void {
  assert.ok(result.ok);
}

describe("copyVfsPath", () => {
  it("copies a file without deleting the source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/a.txt", "hello");
    assertOk(await copyVfsPath(vfs, "/a.txt", "/b.txt"));

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

    assertOk(await copyVfsPath(vfs, "/src", "/dst", { recursive: true }));

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

    const result = await copyVfsPath(vfs, "/src", "/dst");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.key, "VFS_IS_DIRECTORY");
    assert.equal((await vfs.read("/src/x.md")).content, "x");
    await assert.rejects(
      () => vfs.read("/dst/x.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND")
    );
  });
});
