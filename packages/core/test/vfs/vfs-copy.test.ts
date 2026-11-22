import {  rejectsErr, unwrap  } from "../helpers/result-unwrap.js";
import {  AppErrorOps  } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  VfsCopy  } from "../../src/domain/vfs/logic/vfs-copy.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function assertOk(result: { readonly ok: boolean }): void {
    assert.ok(result.ok);
}

describe("copyVfsPath", () => {
    it("copies a file without deleting the source", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const vfs = ctx.sessionVfs(project.id, session.id);

        unwrap(await vfs.write("/a.txt", "hello"));
        assertOk(await VfsCopy.copy(vfs, "/a.txt", "/b.txt"));

        assert.equal(unwrap(await vfs.read("/a.txt")).content, "hello");
        assert.equal(unwrap(await vfs.read("/b.txt")).content, "hello");
    });

    it("copies a directory tree when recursive is true", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const vfs = ctx.sessionVfs(project.id, session.id);

        unwrap(await vfs.mkdir("/src"));
        unwrap(await vfs.write("/src/x.md", "x"));

        assertOk(await VfsCopy.copy(vfs, "/src", "/dst", { recursive: true }));

        assert.equal(unwrap(await vfs.read("/src/x.md")).content, "x");
        assert.equal(unwrap(await vfs.read("/dst/x.md")).content, "x");
    });

    it("fails to copy a directory without recursive", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`p-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const vfs = ctx.sessionVfs(project.id, session.id);

        unwrap(await vfs.mkdir("/src"));
        unwrap(await vfs.write("/src/x.md", "x"));

        const result = await VfsCopy.copy(vfs, "/src", "/dst");
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error.key, "VFS_IS_DIRECTORY");
        assert.equal(unwrap(await vfs.read("/src/x.md")).content, "x");
        await rejectsErr(() => vfs.read("/dst/x.md"), (e: unknown) => {
            assert.ok(AppErrorOps.is(e, "VFS_NOT_FOUND"));
        });
    });
});
