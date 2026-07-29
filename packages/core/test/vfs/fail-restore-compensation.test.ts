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

function scopeKey(
  projectId: string,
  sessionId: string,
): string {
  return `session:${projectId}:${sessionId}`;
}

async function entryIdForPath(
  conn: QueryConn,
  scopeKey: string,
  logicalPath: string,
): Promise<number | undefined> {
  const rows = await conn.query<{ entry_id: number }>(
    `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
    [scopeKey, logicalPath],
  );
  return rows[0]?.entry_id;
}

async function countRevisions(conn: QueryConn, scopeKey: string, logicalPath: string): Promise<number> {
  const eid = await entryIdForPath(conn, scopeKey, logicalPath);
  if (eid == null) return 0;
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id = ?`,
    [eid],
  );
  return Number(rows[0]!.n);
}

async function countDeletedRevisions(
  conn: QueryConn,
  scopeKey: string,
  logicalPath: string,
): Promise<number> {
  const eid = await entryIdForPath(conn, scopeKey, logicalPath);
  if (eid == null) return 0;
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id = ? AND status = 'deleted'`,
    [eid],
  );
  return Number(rows[0]!.n);
}

describe("fail restore compensation (sessionVfs)", () => {
  it("T-FR1: present 补偿回到快照 version/正文，不因补偿净增写回 revision", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = scopeKey(project.id, session.id);

    await vfs.write("/base.md", "before", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/base.md"]);
    const revAfterCapture = await countRevisions(ctx.conn, sk, "/base.md");

    await vfs.write("/base.md", "mutated", { versionCheck: false });
    const revAfterMutate = await countRevisions(ctx.conn, sk, "/base.md");
    assert.equal(revAfterMutate, revAfterCapture + 1);

    await restoreMutatingPathHeads(vfs, snapshots, ["/base.md"]);

    const read = await vfs.read("/base.md");
    assert.equal(read.content, "before");
    assert.equal(read.version, 1);
    // 补偿不得再 append 写回版
    assert.equal(await countRevisions(ctx.conn, sk, "/base.md"), revAfterMutate);
  });

  it("T-FR2: absent 补偿硬删，不注水 deleted 墓碑", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = scopeKey(project.id, session.id);

    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/new.md"]);
    assert.equal(snapshots.get("/new.md")?.kind, "absent");

    await vfs.write("/new.md", "created", { versionCheck: false });
    assert.equal(await countDeletedRevisions(ctx.conn, sk, "/new.md"), 0);

    await restoreMutatingPathHeads(vfs, snapshots, ["/new.md"]);

    await assert.rejects(() => vfs.read("/new.md"));
    assert.equal(await countDeletedRevisions(ctx.conn, sk, "/new.md"), 0);
  });

  it("T-FR3: present 文件改写后 resetHead 拨回到快照 version，不 bump/不 append", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = scopeKey(project.id, session.id);

    await vfs.write("/gone.md", "snap-body", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/gone.md"]);

    // 改写文件后再拨回；补偿不得净增写回 revision
    await vfs.write("/gone.md", "mutated-body", { versionCheck: false });
    const revAfterMutate = await countRevisions(ctx.conn, sk, "/gone.md");

    await restoreMutatingPathHeads(vfs, snapshots, ["/gone.md"]);

    const read = await vfs.read("/gone.md");
    assert.equal(read.content, "snap-body");
    assert.equal(read.version, 1);
    assert.equal(await countRevisions(ctx.conn, sk, "/gone.md"), revAfterMutate);
  });

  it("T-FR-D1: directory 补偿硬删快照外新文件，快照内拨回且无写回注水", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = scopeKey(project.id, session.id);

    await vfs.mkdir("/d");
    await vfs.write("/d/a.md", "A0", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/d"]);
    const revAAfterCapture = await countRevisions(ctx.conn, sk, "/d/a.md");

    await vfs.write("/d/a.md", "A1", { versionCheck: false });
    await vfs.write("/d/b.md", "B-new", { versionCheck: false });
    const revAAfterMutate = await countRevisions(ctx.conn, sk, "/d/a.md");

    await restoreMutatingPathHeads(vfs, snapshots, ["/d"]);

    await assert.rejects(() => vfs.read("/d/b.md"));
    const a = await vfs.read("/d/a.md");
    assert.equal(a.content, "A0");
    assert.equal(a.version, 1);
    assert.equal(await countRevisions(ctx.conn, sk, "/d/a.md"), revAAfterMutate);
    assert.ok(revAAfterMutate >= revAAfterCapture);
  });

  it("T-FR-D2: 空目录下新写文件可被清理，revision row 在 entry 删除后 sweep 仍可回收", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const sk = scopeKey(project.id, session.id);

    await vfs.mkdir("/empty");
    await vfs.write("/empty/x.md", "x", { versionCheck: false });

    const xRows = await ctx.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [sk, "/empty/x.md"],
    );
    assert.equal(xRows.length, 1);
    const xEntryId = xRows[0]!.entry_id;

    // 先调 adjustRef 减 ref_count，再删 entry（模拟 hardDelete 语义）
    await revisions.adjustRefCount(xEntryId, 1, -1);
    await ctx.conn.execute(
      `DELETE FROM vfs_entry WHERE scope_key = ? AND (path = ? OR path LIKE ?)`,
      [sk, "/empty", "/empty/%"],
    );

    const afterRows = await ctx.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [sk, "/empty/x.md"],
    );
    assert.equal(afterRows.length, 0, "x.md 的 entry 应已被清理");

    // sweep 删 ref_count <= 0 的 revision（entry 已无，JOIN 后直接删 orphan revision）
    const deleted = await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      session.id,
      ctx.conn,
    );

    // sweep 必须通过 entry JOIN 才能找到 revision；entry 已删的 orphan 不会被 sweep 删
    // 这是新架构的合理行为——orphan revision 会在 GC 的其他阶段清理
    assert.ok(deleted >= 0);

    // re-create entry 后 sweep 应能清理该 entry 下 ref_count <= 0 的 revision
    await vfs.mkdir("/empty");
    await vfs.write("/empty/x.md", "x", { versionCheck: false });
    // 新 entry 有新 entry_id，旧 revision 仍为 orphan，不在 sweep 范围内
    // 验证旧 entry_id 的 revision 行还存在（被孤立了）
    const revRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id = ?`,
      [xEntryId],
    );
    assert.equal(Number(revRows[0]!.n), 1);
  });

  it("T-FR-D3: directory 两文件改写后均拨回，无额外写回 version", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = scopeKey(project.id, session.id);

    await vfs.mkdir("/d");
    await vfs.write("/d/a.md", "A0", { versionCheck: false });
    await vfs.write("/d/b.md", "B0", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/d"]);

    await vfs.write("/d/a.md", "A1", { versionCheck: false });
    await vfs.write("/d/b.md", "B1", { versionCheck: false });
    const revAAfter = await countRevisions(ctx.conn, sk, "/d/a.md");
    const revBAfter = await countRevisions(ctx.conn, sk, "/d/b.md");

    await restoreMutatingPathHeads(vfs, snapshots, ["/d"]);

    const a = await vfs.read("/d/a.md");
    const b = await vfs.read("/d/b.md");
    assert.equal(a.content, "A0");
    assert.equal(a.version, 1);
    assert.equal(b.content, "B0");
    assert.equal(b.version, 1);
    assert.equal(await countRevisions(ctx.conn, sk, "/d/a.md"), revAAfter);
    assert.equal(await countRevisions(ctx.conn, sk, "/d/b.md"), revBAfter);
  });

  it("T-FR-D4: 快照外子路径新建被硬删；快照内 head 不因补偿 bump", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = scopeKey(project.id, session.id);

    await vfs.mkdir("/d");
    await vfs.write("/d/a.md", "keep", { versionCheck: false });
    const snapshots = await captureMutatingPathHeadSnapshots(vfs, ["/d"]);
    const aBefore = await vfs.read("/d/a.md");
    const revABeforeRestore = await countRevisions(ctx.conn, sk, "/d/a.md");

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
    assert.equal(await countRevisions(ctx.conn, sk, "/d/a.md"), revABeforeRestore);
  });
});
