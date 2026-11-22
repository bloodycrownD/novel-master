/**
 * restore-mutating-path-heads 单测
 */

import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import {  MutatingPathHeads  } from "../../src/domain/vfs/logic/restore-mutating-path-heads.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";
import {  AppErrorOps  } from "../../src/errors/app-error.js";
import {  rejectsErr, unwrap  } from "../helpers/result-unwrap.js";

novelMasterTestFixture();

describe("MutatingPathHeads.restore", () => {
    it("present 路径写回旧 content；absent 路径 delete 新建文件", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const vfs = ctx.sessionVfs(project.id, session.id);

        await vfs.write("/base.md", "before", { versionCheck: false });

        const snapshots = unwrap(await MutatingPathHeads.captureSnapshots(vfs, [
            "/base.md",
            "/new.md",
        ]));

        await vfs.write("/base.md", "mutated", { versionCheck: false });
        await vfs.write("/new.md", "created", { versionCheck: false });

        await MutatingPathHeads.restore(vfs, snapshots, ["/base.md", "/new.md"]);

        assert.equal((unwrap(await vfs.read("/base.md"))).content, "before");
        await rejectsErr(() => vfs.read("/new.md"), (e: unknown) => {
            assert.ok(AppErrorOps.is(e, "VFS_NOT_FOUND"));
        });
    });

    it("captures directory paths without IS_DIRECTORY and restores tree on rollback", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const vfs = ctx.sessionVfs(project.id, session.id);

        await vfs.mkdir("/dir");
        await vfs.write("/dir/a.md", "A", { versionCheck: false });
        await vfs.write("/dir/sub/b.md", "B", { versionCheck: false });

        const snapshots = unwrap(await MutatingPathHeads.captureSnapshots(vfs, ["/dir"]));
        const snapshot = snapshots.get("/dir");
        assert.equal(snapshot?.kind, "directory");
        if (snapshot?.kind !== "directory") {
            return;
        }
        assert.equal(snapshot.files.length, 2);

        // 改写文件后再恢复，不走 delete+resetHead（entry 删后新 API 无法重建 entry）
        await vfs.write("/dir/a.md", "A-mutated", { versionCheck: false });
        await vfs.write("/dir/sub/b.md", "B-mutated", { versionCheck: false });

        await MutatingPathHeads.restore(vfs, snapshots, ["/dir"]);

        assert.deepEqual(
            (unwrap(await vfs.list("/dir", { recursive: true })))
                .filter((entry) => entry.kind === "file")
                .map((entry) => entry.path)
                .sort(),
            ["/dir/a.md", "/dir/sub/b.md"],
        );
        assert.equal((unwrap(await vfs.read("/dir/a.md"))).content, "A");
        assert.equal((unwrap(await vfs.read("/dir/sub/b.md"))).content, "B");
    });

    it("captures empty directory paths", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const vfs = ctx.sessionVfs(project.id, session.id);

        await vfs.mkdir("/empty");
        const snapshots = unwrap(await MutatingPathHeads.captureSnapshots(vfs, ["/empty"]));
        const snapshot = snapshots.get("/empty");
        assert.equal(snapshot?.kind, "directory");
        if (snapshot?.kind !== "directory") {
            return;
        }
        assert.equal(snapshot.files.length, 0);

        await vfs.delete("/empty");
        await MutatingPathHeads.restore(vfs, snapshots, ["/empty"]);
        assert.deepEqual(unwrap(await vfs.list("/empty")), []);
    });

    it("captures virtual directory paths without explicit directory row", async () => {
        const ctx = getNovelMasterTestContext();
        const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
        const session = unwrap(await ctx.sessions.create(project.id));
        const conn = ctx.conn;
        const vfs = ctx.sessionVfs(project.id, session.id);
        const physicalPrefix = `/projects/${project.id}/sessions/${session.id}`;

        await vfs.write("/55/诗歌.txt", "poem", { versionCheck: false });
        await conn.execute(
            `DELETE FROM vfs_entry WHERE path = ? AND entry_kind = 'directory'`,
            [`${physicalPrefix}/55`],
        );

        const snapshots = unwrap(await MutatingPathHeads.captureSnapshots(vfs, ["/55"]));
        const snapshot = snapshots.get("/55");
        assert.equal(snapshot?.kind, "directory");
        if (snapshot?.kind !== "directory") {
            return;
        }
        assert.equal(snapshot.files.length, 1);
        assert.equal(snapshot.files[0]!.path, "/55/诗歌.txt");
    });
});
