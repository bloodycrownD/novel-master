/**
 * restore-mutating-path-heads 单测
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  captureMutatingPathHeadSnapshots,
  restoreMutatingPathHeads,
} from "../../src/domain/vfs/logic/restore-mutating-path-heads.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("restoreMutatingPathHeads", () => {
  it("present 路径写回旧 content；absent 路径 delete 新建文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/base.md", "before", { versionCheck: false });

    const snapshots = await captureMutatingPathHeadSnapshots(vfs, [
      "/base.md",
      "/new.md",
    ]);

    await vfs.write("/base.md", "mutated", { versionCheck: false });
    await vfs.write("/new.md", "created", { versionCheck: false });

    await restoreMutatingPathHeads(vfs, snapshots, ["/base.md", "/new.md"]);

    assert.equal((await vfs.read("/base.md")).content, "before");
    await assert.rejects(() => vfs.read("/new.md"));
  });

  it("captures directory paths without IS_DIRECTORY and restores tree on rollback", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.md", "A", { versionCheck: false });
    await vfs.write("/dir/sub/b.md", "B", { versionCheck: false });

    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/dir"]);
    const snapshot = snapshots.get("/dir");
    assert.equal(snapshot?.kind, "directory");
    if (snapshot?.kind !== "directory") {
      return;
    }
    assert.equal(snapshot.files.length, 2);

    await vfs.delete("/dir", { recursive: true });
    await assert.rejects(() => vfs.list("/dir"));

    await restoreMutatingPathHeads(vfs, snapshots, ["/dir"]);

    assert.deepEqual(
      (await vfs.list("/dir", { recursive: true }))
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path)
        .sort(),
      ["/dir/a.md", "/dir/sub/b.md"],
    );
    assert.equal((await vfs.read("/dir/a.md")).content, "A");
    assert.equal((await vfs.read("/dir/sub/b.md")).content, "B");
  });

  it("captures empty directory paths", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.mkdir("/empty");
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/empty"]);
    const snapshot = snapshots.get("/empty");
    assert.equal(snapshot?.kind, "directory");
    if (snapshot?.kind !== "directory") {
      return;
    }
    assert.equal(snapshot.files.length, 0);

    await vfs.delete("/empty");
    await restoreMutatingPathHeads(vfs, snapshots, ["/empty"]);
    assert.deepEqual(await vfs.list("/empty"), []);
  });

  it("captures virtual directory paths without explicit directory row", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const conn = ctx.conn;
    const vfs = ctx.sessionVfs(project.id, session.id);
    const physicalPrefix = `/projects/${project.id}/sessions/${session.id}`;

    await vfs.write("/55/诗歌.txt", "poem", { versionCheck: false });
    await conn.execute(
      `DELETE FROM vfs_entry WHERE path = ? AND entry_kind = 'directory'`,
      [`${physicalPrefix}/55`],
    );

    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/55"]);
    const snapshot = snapshots.get("/55");
    assert.equal(snapshot?.kind, "directory");
    if (snapshot?.kind !== "directory") {
      return;
    }
    assert.equal(snapshot.files.length, 1);
    assert.equal(snapshot.files[0]!.path, "/55/诗歌.txt");
  });
});
