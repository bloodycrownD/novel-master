/**
 * T-FR* / T-FR-D*：失败补偿走 resetHead/hardDelete（经 sessionVfs）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureMutatingPathHeadSnapshots,
  restoreMutatingPathHeads,
} from "../../src/domain/vfs/logic/restore-mutating-path-heads.js";
import { sweepSessionRevisions } from "../../src/domain/message-checkpoint/logic/revision-gc.js";
import { runDeferredBlobGc } from "../../src/domain/vfs/logic/deferred-blob-gc.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsContentStore } from "../../src/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

type QueryConn = {
  query: <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<T[]>;
};

function physicalPath(
  projectId: string,
  sessionId: string,
  logical: string,
): string {
  const suffix = logical === "/" ? "" : logical;
  return `/projects/${projectId}/sessions/${sessionId}${suffix}`;
}

async function countRevisions(conn: QueryConn, path: string): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vfs_revision WHERE path = ?`,
    [path],
  );
  return Number(rows[0]!.n);
}

async function countDeletedRevisions(
  conn: QueryConn,
  path: string,
): Promise<number> {
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vfs_revision WHERE path = ? AND status = 'deleted'`,
    [path],
  );
  return Number(rows[0]!.n);
}

describe("fail restore compensation (sessionVfs)", () => {
  it("T-FR1: present 补偿回到快照 version/正文，不因补偿净增写回 revision", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const phys = physicalPath(project.id, session.id, "/base.md");

    await vfs.write("/base.md", "before", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/base.md"]);
    const revAfterCapture = await countRevisions(ctx.conn, phys);

    await vfs.write("/base.md", "mutated", { versionCheck: false });
    const revAfterMutate = await countRevisions(ctx.conn, phys);
    assert.equal(revAfterMutate, revAfterCapture + 1);

    await restoreMutatingPathHeads(vfs, snapshots, ["/base.md"]);

    const read = await vfs.read("/base.md");
    assert.equal(read.content, "before");
    assert.equal(read.version, 1);
    // 补偿不得再 append 写回版
    assert.equal(await countRevisions(ctx.conn, phys), revAfterMutate);
  });

  it("T-FR2: absent 补偿硬删，不注水 deleted 墓碑", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const phys = physicalPath(project.id, session.id, "/new.md");

    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/new.md"]);
    assert.equal(snapshots.get("/new.md")?.kind, "absent");

    await vfs.write("/new.md", "created", { versionCheck: false });
    assert.equal(await countDeletedRevisions(ctx.conn, phys), 0);

    await restoreMutatingPathHeads(vfs, snapshots, ["/new.md"]);

    await assert.rejects(() => vfs.read("/new.md"));
    assert.equal(await countDeletedRevisions(ctx.conn, phys), 0);
  });

  it("T-FR3: present 文件被删后 resetHead 按 revision 重建 live，不 bump/不 append", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const phys = physicalPath(project.id, session.id, "/gone.md");

    await vfs.write("/gone.md", "snap-body", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/gone.md"]);

    // 批次中常规 delete 会注水墓碑；补偿不得再叠写回版
    await vfs.delete("/gone.md");
    const revAfterDelete = await countRevisions(ctx.conn, phys);

    await restoreMutatingPathHeads(vfs, snapshots, ["/gone.md"]);

    const read = await vfs.read("/gone.md");
    assert.equal(read.content, "snap-body");
    assert.equal(read.version, 1);
    assert.equal(await countRevisions(ctx.conn, phys), revAfterDelete);
  });

  it("T-FR-D1: directory 补偿硬删快照外新文件，快照内拨回且无写回注水", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const physA = physicalPath(project.id, session.id, "/d/a.md");

    await vfs.mkdir("/d");
    await vfs.write("/d/a.md", "A0", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/d"]);
    const revAAfterCapture = await countRevisions(ctx.conn, physA);

    await vfs.write("/d/a.md", "A1", { versionCheck: false });
    await vfs.write("/d/b.md", "B-new", { versionCheck: false });
    const revAAfterMutate = await countRevisions(ctx.conn, physA);

    await restoreMutatingPathHeads(vfs, snapshots, ["/d"]);

    await assert.rejects(() => vfs.read("/d/b.md"));
    const a = await vfs.read("/d/a.md");
    assert.equal(a.content, "A0");
    assert.equal(a.version, 1);
    assert.equal(await countRevisions(ctx.conn, physA), revAAfterMutate);
    assert.ok(revAAfterMutate >= revAAfterCapture);
  });

  it("T-FR-D2: 空目录快照补偿后残留文件消失，目录仍可 list", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const contentStore = new SqliteVfsContentStore(ctx.conn);
    const physX = physicalPath(project.id, session.id, "/empty/x.md");
    const orphanHash = hashContent("x");

    await vfs.mkdir("/empty");
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/empty"]);
    assert.equal(snapshots.get("/empty")?.kind, "directory");

    await vfs.write("/empty/x.md", "x", { versionCheck: false });
    await restoreMutatingPathHeads(vfs, snapshots, ["/empty"]);

    await assert.rejects(() => vfs.read("/empty/x.md"));
    assert.deepEqual(await vfs.list("/empty"), []);

    // recursive hardDelete 补偿须 −live ref；sweep 后 revision / orphan blob 可回收
    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      session.id,
      ctx.conn,
    );
    await runDeferredBlobGc(ctx.conn);

    assert.equal(await revisions.findByPathAndVersion(physX, 1), null);
    await assert.rejects(() => contentStore.get(orphanHash));
  });

  it("T-FR-D3: directory 两文件改写+删除后均拨回（含重建），无额外写回 version", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const physA = physicalPath(project.id, session.id, "/d/a.md");
    const physB = physicalPath(project.id, session.id, "/d/b.md");

    await vfs.mkdir("/d");
    await vfs.write("/d/a.md", "A0", { versionCheck: false });
    await vfs.write("/d/b.md", "B0", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/d"]);

    await vfs.write("/d/a.md", "A1", { versionCheck: false });
    await vfs.delete("/d/b.md");
    const revAAfter = await countRevisions(ctx.conn, physA);
    const revBAfter = await countRevisions(ctx.conn, physB);

    await restoreMutatingPathHeads(vfs, snapshots, ["/d"]);

    const a = await vfs.read("/d/a.md");
    const b = await vfs.read("/d/b.md");
    assert.equal(a.content, "A0");
    assert.equal(a.version, 1);
    assert.equal(b.content, "B0");
    assert.equal(b.version, 1);
    assert.equal(await countRevisions(ctx.conn, physA), revAAfter);
    assert.equal(await countRevisions(ctx.conn, physB), revBAfter);
  });

  it("T-FR-D4: 快照外子路径新建被硬删；快照内 head 不因补偿 bump", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const physA = physicalPath(project.id, session.id, "/d/a.md");

    await vfs.mkdir("/d");
    await vfs.write("/d/a.md", "keep", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/d"]);
    const aBefore = await vfs.read("/d/a.md");
    const revABeforeRestore = await countRevisions(ctx.conn, physA);

    await vfs.write("/d/sub/new.md", "extra", { versionCheck: false });
    // 未改 a 时同文短路，version 仍为快照值
    await vfs.write("/d/a.md", "keep", {
      expectedVersion: aBefore.version,
    });

    await restoreMutatingPathHeads(vfs, snapshots, ["/d"]);

    await assert.rejects(() => vfs.read("/d/sub/new.md"));
    const a = await vfs.read("/d/a.md");
    assert.equal(a.content, "keep");
    assert.equal(a.version, aBefore.version);
    assert.equal(await countRevisions(ctx.conn, physA), revABeforeRestore);
  });
});
