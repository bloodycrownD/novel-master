/**
 * T-RB-HOT-NOBLOB / T-RB-REF-* / T-RB-GC-DEFER 引用计数与延期 blob GC 测试。
 *
 * entry_id 化后 revision 按 entryId 寻址；裸 SQL 改 entry_id 列名。
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
  scopeKey,
  toPhysicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { revisionPairKey } from "@/domain/vfs/logic/revision-pair-key.js";
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
      gcSpy.mock.restore();
    }

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
    const sk = scopeKey(scope);
    const entries = new SqliteVfsEntryRepository(ctx.conn);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/cap.md", "body", { versionCheck: false });
    const version = (await svfs.read("/cap.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const entry = await entries.findByPath(sk, "/cap.md");
    assert.ok(entry != null);
    const rows = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entry.entryId, version],
    );
    assert.equal(Number(rows[0]?.ref_count), 2);
  });

  it("T-RB-REF-MISSING: adjustRefCount +1 对缺失 revision 行抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    await assert.rejects(
      () => revisions.adjustRefCount(999999, 1, 1),
      (err: unknown) => isVfsError(err, "NOT_FOUND"),
    );
  });

  it("T-RB-REF-LIVE: write bump 时 live ref 从旧版转移到新版", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const sk = scopeKey(scope);

    await svfs.write("/live.md", "a", { versionCheck: false });
    const v1 = (await svfs.read("/live.md")).version;
    await svfs.write("/live.md", "b", { versionCheck: false });
    const v2 = (await svfs.read("/live.md")).version;

    const entry = await entries.findByPath(sk, "/live.md");
    assert.ok(entry != null);
    const eid = entry.entryId;

    const r1 = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [eid, v1],
    );
    const r2 = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [eid, v2],
    );
    assert.equal(Number(r1[0]?.ref_count), 0);
    assert.equal(Number(r2[0]?.ref_count), 1);
  });

  it("T-RB-REF-MULTI: 同 path+version 跨多 checkpoint；删一仍存活", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const sk = scopeKey(scope);

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

    const entry = await entries.findByPath(sk, "/multi.md");
    assert.ok(entry != null);
    const eid = entry.entryId;

    const before = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [eid, version],
    );
    assert.equal(Number(before[0]?.ref_count), 3);

    await ctx.messages.delete(a2.id);

    const after = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [eid, version],
    );
    assert.equal(Number(after[0]?.ref_count), 2);
    assert.ok(
      await revisions.findByEntryAndVersion(eid, version),
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
    const sk = scopeKey(scope);
    const physical = toPhysicalPath(scope, "/conserv.md");

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/conserv.md", "keep", { versionCheck: false });
    const version = (await svfs.read("/conserv.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const entry = await entries.findByPath(sk, "/conserv.md");
    assert.ok(entry != null);
    const eid = entry.entryId;

    await ctx.conn.execute(
      `UPDATE vfs_revision SET ref_count = 0 WHERE entry_id = ? AND version = ?`,
      [eid, version],
    );

    const report = await repairRefCounts(
      revisions,
      entries,
      checkpoints,
      sk,
      "/",
      session.id,
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
    assert.ok(await revisions.findByEntryAndVersion(eid, version));
  });

  it("T-RB-REF-TRUNC: 回滚截断 tail checkpoint 后 ref 递减且归零 revision 被删", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const sk = scopeKey(scope);

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

    const entryA = await entries.findByPath(sk, "/trunc-a.md");
    const entryTail = await entries.findByPath(sk, "/tail-only.md");
    assert.ok(entryA != null);
    assert.ok(entryTail != null);

    const tailRefBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entryA.entryId, vTail],
    );
    assert.equal(Number(tailRefBefore[0]?.ref_count), 2);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/trunc-a.md")).content, "anchor");
    // tail revision 的 ref 归零（checkpoint 解除 + live head 回退到 anchor），应被 sweep
    assert.equal(
      await revisions.findByEntryAndVersion(entryA.entryId, vTail),
      null,
    );
    // tail-only.md 在 cp2 tail checkpoint 里且不在 cp1 targetTree 里，回滚时
    // reconcileVfsPaths 会 vfs.delete 它（entry 被删）+ truncateTail 的 checkpoint
    // 引用 -1，vOrphan ref_count 归零、entry 不存在 → 成为全局孤儿，被
    // deleteGlobalOrphans 回收（findings 发现 14 修复后不再残留）。
    const tailEntryAfter = await entries.findByPath(sk, "/tail-only.md");
    assert.equal(tailEntryAfter, null, "tail-only.md 回滚后 entry 应被删");
    assert.equal(
      await revisions.findByEntryAndVersion(entryTail.entryId, vOrphan),
      null,
      "tail-only.md 的 vOrphan revision 应被全局孤儿清扫回收",
    );

    assert.ok(await revisions.findByEntryAndVersion(entryA.entryId, vAnchor));
    const anchorRef = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entryA.entryId, vAnchor],
    );
    assert.ok(Number(anchorRef[0]?.ref_count) >= 1);
  });

  it("T-RB-SESSION-DEL: deleteSessionFsData −checkpoint/live ref 并打扫 revision", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const sk = scopeKey(scope);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "w" }],
    });
    await svfs.write("/session-del.md", "gone", { versionCheck: false });
    const version = (await svfs.read("/session-del.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const entry = await entries.findByPath(sk, "/session-del.md");
    assert.ok(entry != null);
    const eid = entry.entryId;

    const refBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [eid, version],
    );
    assert.equal(Number(refBefore[0]?.ref_count), 2);

    await deleteSessionFsData(ctx.conn, session.id, project.id);

    assert.equal(
      (await checkpoints.listFilePointersForSession(session.id)).length,
      0,
    );
    assert.equal(await revisions.findByEntryAndVersion(eid, version), null);
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
    const orphanContent = "orphan-" + testIsolationSuffix();
    await svfs.write("/defer.md", "keep", { versionCheck: false });
    await svfs.write("/defer.md", orphanContent, { versionCheck: false });
    await svfs.write("/defer.md", "keep-final", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);

    const orphanHash = hashContent(orphanContent);
    const entry = await entries.findByPath(scopeKey({kind:"session",projectId:project.id,sessionId:session.id}), "/defer.md");
    assert.ok(entry != null);
    // 确认 orphan revision 存在
    const orphanRev = await revisions.findByEntryAndVersion(entry.entryId, 2);
    assert.ok(orphanRev != null, "orphan revision 应在 sweep 前存在");

    await sweepSessionRevisions(
      revisions,
      entries,
      checkpoints,
      project.id,
      session.id,
      ctx.conn,
    );

    // sweep 后 orphan revision 应被删除
    const afterSweep = await revisions.findByEntryAndVersion(entry.entryId, 2);
    assert.equal(afterSweep, null, "orphan revision 应在 sweep 后被删除");

    // content_hash 列始终存 hashContent() 输出的 hex 格式（SHA-256 hex），
    // zlib b64 只影响 bytes 列编码，不影响 content_hash 列。可直接精确验证 blob gc。
    await runDeferredBlobGc(ctx.conn);
    await assert.rejects(() => contentStore.get(orphanHash));
    assert.equal((await svfs.read("/defer.md")).content, "keep-final");
  });
});
