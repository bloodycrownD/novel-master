import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorktreeRepository } from "@/domain/worktree/repositories/impl/sqlite-worktree.repository.js";
import { DefaultWorktreeService } from "@/service/worktree/impl/worktree.service.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

function createSpyingWorktreeService(
  conn: import("@novel-master/core").TdbcConnection,
  projectId: string,
) {
  const baseRepo = new SqliteVfsEntryRepository(conn);
  const calls = {
    scanContents: 0,
    findByPath: 0,
    listFileMetaUnderPrefix: 0,
  };

  const vfs: VfsEntryRepository = {
    list: (...args) => baseRepo.list(...args),
    findByPath: async (...args) => {
      calls.findByPath += 1;
      return baseRepo.findByPath(...args);
    },
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
    scanContents: async (...args) => {
      calls.scanContents += 1;
      return baseRepo.scanContents(...args);
    },
  };

  const wt = new DefaultWorktreeService({
    scope: { kind: "project", projectId },
    vfs,
    worktree: new SqliteWorktreeRepository(conn),
  });

  return { wt, calls, vfs: baseRepo };
}


novelMasterTestFixture();

describe("worktree materialize", () => {
  it("buildListRows and materialize list path never call scanContents", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/hidden/a.md", "A");
    await pvfs.write("/hidden/b.md", "B");
    await pvfs.write("/visible/c.md", "C");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn, project.id);
    await wt.setFileRule({
      logicalPath: "/visible/c.md",
      inclusionMode: "show",
    });

    calls.scanContents = 0;
    calls.findByPath = 0;
    const rows = await wt.buildListRows();
    assert.ok(rows.length >= 4);
    assert.equal(calls.scanContents, 0);
    assert.equal(calls.findByPath, 0);

    calls.scanContents = 0;
    calls.findByPath = 0;
    calls.listFileMetaUnderPrefix = 0;
    const materialized = await wt.materialize();
    assert.equal(calls.scanContents, 0);
    assert.ok(materialized.listRows.length >= 4);
    assert.equal(
      calls.listFileMetaUnderPrefix,
      2,
      "deprecated materialize 组合 live + persist 各一次 metadata",
    );
  });

  it("filename fill display never calls findByPath", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/fn/a.md", "BODY-A");
    await pvfs.write("/fn/b.md", "BODY-B");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn, project.id);
    await wt.setDirRule({
      logicalPath: "/fn",
      ruleEnabled: true,
      headCount: 0,
      tailCount: 0,
      fillPolicy: "filename",
    });

    calls.findByPath = 0;
    const materialized = await wt.materialize();
    assert.equal(calls.findByPath, 0);
    assert.match(materialized.worktreeDisplay, /a\.md/);
    assert.match(materialized.worktreeDisplay, /b\.md/);
    assert.doesNotMatch(materialized.worktreeDisplay, /BODY-A/);
  });

  it("lazy findByPath only for visible full/header files", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    for (let i = 0; i < 10; i += 1) {
      await pvfs.write(`/batch/f${i}.md`, `body-${i}`);
    }
    await pvfs.write("/batch/show-a.md", "FULL-A");
    await pvfs.write("/batch/show-b.md", "FULL-B");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn, project.id);
    await wt.setFileRule({
      logicalPath: "/batch/show-a.md",
      inclusionMode: "show",
    });
    await wt.setFileRule({
      logicalPath: "/batch/show-b.md",
      inclusionMode: "show",
    });
    await wt.setDirRule({
      logicalPath: "/batch",
      headCount: 0,
      tailCount: 0,
      fillPolicy: "hidden",
    });

    calls.findByPath = 0;
    const materialized = await wt.materialize();
    assert.equal(
      calls.findByPath,
      2,
      "only show (full) files read content; auto files hidden",
    );
    assert.match(materialized.worktreeDisplay, /show-a\.md/);
    assert.match(materialized.worktreeDisplay, /show-b\.md/);
  });

  it("materialize listRows match buildListRows order", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/parent/a.md", "A");
    await pvfs.write("/parent/sub/b.md", "B");

    const wt = createSpyingWorktreeService(ctx.conn, project.id).wt;
    await wt.setFileRule({
      logicalPath: "/parent/a.md",
      inclusionMode: "show",
    });
    await wt.setFileRule({
      logicalPath: "/parent/sub/b.md",
      inclusionMode: "show",
    });

    const [rows, materialized] = await Promise.all([
      wt.buildListRows(),
      wt.materialize(),
    ]);
    assert.deepEqual(
      rows.map((r) => r.path),
      materialized.listRows.map((r) => r.path),
    );
  });

  it("materialize filetreeDisplay 与 renderFileTree 一致且含加载后缀", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "A");
    await pvfs.write("/b.md", "B");

    const { wt } = createSpyingWorktreeService(ctx.conn, project.id);
    await wt.setFileRule({
      logicalPath: "/a.md",
      inclusionMode: "show",
    });

    const materialized = await wt.materialize();
    const fileTree = await wt.renderFileTree();
    assert.equal(materialized.filetreeDisplay, fileTree);
    assert.match(materialized.filetreeDisplay, /a\.md 全部加载/);
  });

  it("T-WEC11: capture 后 renderDisplay 与快照一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "hello");

    const { createSessionWorktreeBlockStore, createWorktreeService } =
      await import("@novel-master/core/worktree");
    const store = createSessionWorktreeBlockStore();
    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    const { worktreeDisplay } = await wt.materializePersistBlock();
    store.capture(project.id, session.id, { worktreeDisplay });
    const block = store.getCapturedBlock(project.id, session.id);
    assert.ok(block != null && block.worktreeDisplay.length > 0);
    const display = await wt.renderDisplay();
    assert.equal(block!.worktreeDisplay, display);
  });
});
