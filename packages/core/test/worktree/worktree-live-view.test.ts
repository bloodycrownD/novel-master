import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorktreeRepository } from "@/domain/worktree/repositories/impl/sqlite-worktree.repository.js";
import { DefaultWorktreeService } from "@/service/worktree/impl/worktree.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

function createSpyingWorktreeService(
  conn: import("@novel-master/core").TdbcConnection,
  projectId: string,
) {
  const baseRepo = new SqliteVfsEntryRepository(conn);
  const calls = {
    listFileMetaUnderPrefix: 0,
  };

  const vfs: VfsEntryRepository = {
    list: (...args) => baseRepo.list(...args),
    findByPath: (...args) => baseRepo.findByPath(...args),
    insert: (...args) => baseRepo.insert(...args),
    insertAtVersion: (...args) => baseRepo.insertAtVersion(...args),
    insertDirectory: (...args) => baseRepo.insertDirectory(...args),
    update: (...args) => baseRepo.update(...args),
    delete: (...args) => baseRepo.delete(...args),
    listAllPaths: (...args) => baseRepo.listAllPaths(...args),
    listDirectoryPathsUnderPrefix: (...args) =>
      baseRepo.listDirectoryPathsUnderPrefix(...args),
    listEntriesUnderPrefix: (...args) =>
      baseRepo.listEntriesUnderPrefix(...args),
    listFileMetaUnderPrefix: async (...args) => {
      calls.listFileMetaUnderPrefix += 1;
      return baseRepo.listFileMetaUnderPrefix(...args);
    },
    scanContents: (...args) => baseRepo.scanContents(...args),
  };

  const wt = new DefaultWorktreeService({
    scope: { kind: "project", projectId },
    vfs,
    worktree: new SqliteWorktreeRepository(conn),
  });

  return { wt, calls };
}

novelMasterTestFixture();

describe("worktree materializeLiveView", () => {
  it("materializeLiveView 仅加载一次 metadata", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/b.md", "B");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn, project.id);
    calls.listFileMetaUnderPrefix = 0;

    const live = await wt.materializeLiveView();
    assert.ok(live.listRows.length >= 3);
    assert.ok(live.filetreeDisplay.length > 0);
    assert.equal(calls.listFileMetaUnderPrefix, 1);
  });

  it("并发 buildListRows + renderFileTree 合并为单次 metadata", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/x.md", "X");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn, project.id);
    calls.listFileMetaUnderPrefix = 0;

    const [rows, fileTree] = await Promise.all([
      wt.buildListRows(),
      wt.renderFileTree(),
    ]);
    assert.ok(rows.length >= 2);
    assert.ok(fileTree.length > 0);
    assert.equal(
      calls.listFileMetaUnderPrefix,
      1,
      "并发调用应合并为单次 metadata 加载",
    );
  });

  it("委托方法与 materializeLiveView 字段一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/parity/a.md", "A");
    await pvfs.write("/parity/b.md", "B");

    const { wt } = createSpyingWorktreeService(ctx.conn, project.id);
    await wt.setFileRule({
      logicalPath: "/parity/a.md",
      inclusionMode: "show",
    });

    const live = await wt.materializeLiveView();
    const rows = await wt.buildListRows();
    const fileTree = await wt.renderFileTree();

    assert.deepEqual(
      rows.map((r) => r.path),
      live.listRows.map((r) => r.path),
    );
    assert.equal(fileTree, live.filetreeDisplay);
  });
});
