/**
 * T-RB-HOT-NOBLOB / T-RB-REF-* / T-RB-GC-DEFER 引用计数与延期 blob GC 测试。
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { repairRefCounts } from "@/domain/vfs/logic/revision-ref-count.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import {
  toPhysicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { deleteSessionFsData } from "@/service/session-fs/create-session-fs-service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("rollback ref_count + deferred blob gc", () => {
  it("T-RB-HOT-NOBLOB: rollbackToMessage 热路径不 sync collect/gc", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const collectSpy = mock.method(
      SqliteVfsContentStore.prototype,
      "collectAllReferencedHashes",
    );
    const gcSpy = mock.method(SqliteVfsContentStore.prototype, "gc");

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "anchor" }],
    });
    await svfs.write("/hot.md", "anchor", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "tail" }],
    });
    await svfs.write("/hot.md", "tail", { versionCheck: false });
    await svfs.write("/tail-only.md", "orphan", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    try {
      await ctx.sessionFs.rollbackToMessage(
        session.id,
        project.id,
        assistant1.id,
      );
    } finally {
      collectSpy.mock.restore();
      gcSpy.mock.restore();
    }

    assert.equal(collectSpy.mock.callCount(), 0);
    assert.equal(gcSpy.mock.callCount(), 0);
    assert.equal((await svfs.read("/hot.md")).content, "anchor");
  });

  it("T-RB-REF-CAP: capture 后 checkpoint 指针对应 ref 累加", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/cap.md");

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/cap.md", "body", { versionCheck: false });
    const version = (await svfs.read("/cap.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const rows = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physical, version],
    );
    assert.equal(Number(rows[0]?.ref_count), 2);
  });

  it("T-RB-REF-MISSING: adjustRefCount +1 对缺失 revision 行抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    await assert.rejects(
      () => revisions.adjustRefCount("/missing/revision.md", 1, 1),
      (err: unknown) => isVfsError(err, "NOT_FOUND"),
    );
  });

  it("T-RB-REF-LIVE: write bump 时 live ref 从旧版转移到新版", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/live.md");

    await svfs.write("/live.md", "a", { versionCheck: false });
    const v1 = (await svfs.read("/live.md")).version;
    await svfs.write("/live.md", "b", { versionCheck: false });
    const v2 = (await svfs.read("/live.md")).version;

    const r1 = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physical, v1],
    );
    const r2 = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physical, v2],
    );
    assert.equal(Number(r1[0]?.ref_count), 0);
    assert.equal(Number(r2[0]?.ref_count), 1);
  });

  it("T-RB-REF-MULTI: 同 path+version 跨多 checkpoint；删一仍存活", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/multi.md");

    await svfs.write("/multi.md", "same", { versionCheck: false });
    const version = (await svfs.read("/multi.md")).version;
    const a1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "1" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, a1.id);
    const a2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "2" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, a2.id);

    const before = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physical, version],
    );
    assert.equal(Number(before[0]?.ref_count), 3);

    await ctx.messages.delete(a2.id);

    const after = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physical, version],
    );
    assert.equal(Number(after[0]?.ref_count), 2);
    assert.ok(
      await new SqliteVfsRevisionRepository(ctx.conn).findByPathAndVersion(
        physical,
        version,
      ),
    );
  });

  it("T-RB-REF-CONSERV: repair 只上调 ref，不得因偏低误删仍引用行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/conserv.md");

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/conserv.md", "keep", { versionCheck: false });
    const version = (await svfs.read("/conserv.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    await ctx.conn.execute(
      `UPDATE vfs_revision SET ref_count = 0 WHERE path = ? AND version = ?`,
      [physical, version],
    );

    const report = await repairRefCounts(
      revisions,
      entries,
      checkpoints,
      scope,
    );
    assert.ok(report.rowsAdjusted >= 1);

    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      session.id,
      ctx.conn,
    );
    assert.ok(await revisions.findByPathAndVersion(physical, version));
  });

  it("T-RB-REF-TRUNC: 回滚截断 tail checkpoint 后 ref 递减且归零 revision 被删", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physicalA = toPhysicalPath(scope, "/trunc-a.md");
    const physicalTail = toPhysicalPath(scope, "/tail-only.md");

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "cp1" }],
    });
    await svfs.write("/trunc-a.md", "anchor", { versionCheck: false });
    const vAnchor = (await svfs.read("/trunc-a.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "cp2" }],
    });
    await svfs.write("/trunc-a.md", "tail", { versionCheck: false });
    const vTail = (await svfs.read("/trunc-a.md")).version;
    await svfs.write("/tail-only.md", "orphan", { versionCheck: false });
    const vOrphan = (await svfs.read("/tail-only.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    const tailRefBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physicalA, vTail],
    );
    assert.equal(Number(tailRefBefore[0]?.ref_count), 2);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/trunc-a.md")).content, "anchor");
    assert.equal(
      await revisions.findByPathAndVersion(physicalA, vTail),
      null,
    );
    assert.equal(
      await revisions.findByPathAndVersion(physicalTail, vOrphan),
      null,
    );

    assert.ok(await revisions.findByPathAndVersion(physicalA, vAnchor));
    const anchorRef = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physicalA, vAnchor],
    );
    assert.ok(Number(anchorRef[0]?.ref_count) >= 1);
  });

  it("T-RB-SESSION-DEL: deleteSessionFsData −checkpoint/live ref 并打扫 revision", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const physical = toPhysicalPath(scope, "/session-del.md");

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/session-del.md", "gone", { versionCheck: false });
    const version = (await svfs.read("/session-del.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const refBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE path = ? AND version = ?`,
      [physical, version],
    );
    assert.equal(Number(refBefore[0]?.ref_count), 2);

    await deleteSessionFsData(ctx.conn, session.id, project.id);

    assert.equal(
      (await checkpoints.listFilePointersForSession(session.id)).length,
      0,
    );
    assert.equal(await revisions.findByPathAndVersion(physical, version), null);
  });

  it("T-RB-GC-DEFER: sweep 后 runDeferredBlobGc 删除 orphan blob", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const contentStore = new SqliteVfsContentStore(ctx.conn);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/defer.md", "keep", { versionCheck: false });
    await svfs.write("/defer.md", "orphan", { versionCheck: false });
    await svfs.write("/defer.md", "keep-final", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const orphanHash = hashContent("orphan");
    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      session.id,
      ctx.conn,
    );
    await runDeferredBlobGc(ctx.conn);

    await assert.rejects(() => contentStore.get(orphanHash));
    assert.equal((await svfs.read("/defer.md")).content, "keep-final");
  });
});
