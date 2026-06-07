import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorktreeRepository } from "@/domain/worktree/repositories/impl/sqlite-worktree.repository.js";
import { DefaultWorktreeService } from "@/service/worktree/impl/worktree.service.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

function createSpyingWorktreeService(
  conn: import("@novel-master/core").TdbcConnection,
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
    scope: { kind: "global" },
    vfs,
    worktree: new SqliteWorktreeRepository(conn),
  });

  return { wt, calls, vfs: baseRepo };
}

describe("worktree materialize", () => {
  it("buildListRows and materialize list path never call scanContents", async () => {
    const ctx = await openNovelMasterTestConnection();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/hidden/a.md", "A");
    await gvfs.write("/hidden/b.md", "B");
    await gvfs.write("/visible/c.md", "C");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn);
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
    const materialized = await wt.materialize();
    assert.equal(calls.scanContents, 0);
    assert.ok(materialized.listRows.length >= 4);
    assert.equal(calls.listFileMetaUnderPrefix, 2);

    await ctx.conn.close();
  });

  it("filename fill display never calls findByPath", async () => {
    const ctx = await openNovelMasterTestConnection();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/fn/a.md", "BODY-A");
    await gvfs.write("/fn/b.md", "BODY-B");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn);
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

    await ctx.conn.close();
  });

  it("lazy findByPath only for visible full/header files", async () => {
    const ctx = await openNovelMasterTestConnection();
    const gvfs = ctx.globalVfs();
    for (let i = 0; i < 10; i += 1) {
      await gvfs.write(`/batch/f${i}.md`, `body-${i}`);
    }
    await gvfs.write("/batch/show-a.md", "FULL-A");
    await gvfs.write("/batch/show-b.md", "FULL-B");

    const { wt, calls } = createSpyingWorktreeService(ctx.conn);
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

    await ctx.conn.close();
  });

  it("materialize listRows match buildListRows order", async () => {
    const ctx = await openNovelMasterTestConnection();
    const gvfs = ctx.globalVfs();
    await gvfs.write("/parent/a.md", "A");
    await gvfs.write("/parent/sub/b.md", "B");

    const wt = createSpyingWorktreeService(ctx.conn).wt;
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

    await ctx.conn.close();
  });

  it("session macro cache refresh stores listRows from materialize", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "hello");

    const { createSessionMacroCache, createWorktreeService } = await import(
      "@novel-master/core"
    );
    const macroCache = createSessionMacroCache();
    const wt = createWorktreeService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    const snapshot = await macroCache.refresh(
      project.id,
      session.id,
      () => wt.materialize(),
    );
    assert.ok(snapshot.listRows.length >= 2);
    const materialized = await wt.materialize();
    assert.deepEqual(
      snapshot.listRows.map((r) => r.path),
      materialized.listRows.map((r) => r.path),
    );

    await ctx.conn.close();
  });
});
