/**
 * T-GC1：删文件后 revision + blob 孤儿泄漏的回归测试（findings 发现 14）。
 *
 * 修复前：vfs.delete 删文件后 entry 行被删，旧版 active revision 的 ref_count 被减到 0
 * 但行还在。revision GC 的 deleteUnreferencedUnderScope 靠 JOIN vfs_entry 圈定范围，
 * entry 已删的 revision JOIN 不到，成为扫不到的孤儿，其 blob 也无法回收——数据库只增不减。
 *
 * 修复后：sweepSessionRevisions 在 path-scoped 清扫后追加 deleteGlobalOrphans，
 * 把 entry 已删、ref_count<=0 的 revision 全清掉，revision DELETE 触发器连带回收 blob。
 *
 * 说明：vfs.delete 给 deleted 版 revision 追加 +1 ref_count（live head 转移），
 * 所以 deleted 版（content_hash NULL、ref_count=1）不在本步清扫范围——它没有 blob，
 * 不构成数据泄漏。本用例聚焦「有 content_hash 的 active 孤儿 revision + blob」全清。
 *
 * @module test/vfs/orphan-revision-gc
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { sweepSessionRevisions } from "@/domain/message-checkpoint/logic/revision-gc.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("T-GC1: orphan revision + blob GC（findings 发现 14）", () => {
  it("删全部文件后，sweepSessionRevisions 清掉孤儿 active revision 与 blob", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-orphan-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const revRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);

    // 造 10 文件 × 2 版：每个文件 v1（ref_count=0，有 content_hash）+ v2（live head）。
    // 每条 active revision 内容不同，确保 blob 一对一（不共享），方便断言 blob 全清。
    const totalFiles = 10;
    for (let i = 0; i < totalFiles; i++) {
      await vfs.write(`/orphan/file-${i}.txt`, `body-v1-${i}`, {
        versionCheck: false,
      });
      await vfs.write(`/orphan/file-${i}.txt`, `body-v2-${i}`, {
        versionCheck: false,
      });
    }

    const beforeActiveRev = await ctx.conn.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vfs_revision WHERE status='active' AND content_hash IS NOT NULL`,
    );
    const beforeBlob = await ctx.conn.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vfs_content_blob`,
    );
    // 10 文件 × 2 版 active = 20 条；20 个不同内容 = 20 个 blob。
    assert.equal(
      Number(beforeActiveRev[0]!.cnt),
      totalFiles * 2,
      "造数据后应有 20 条 active+有hash revision",
    );
    assert.equal(
      Number(beforeBlob[0]!.cnt),
      totalFiles * 2,
      "造数据后应有 20 个 blob",
    );

    // 删掉全部文件：entry 被删，旧版 active revision 成为 JOIN 孤儿。
    for (let i = 0; i < totalFiles; i++) {
      await vfs.delete(`/orphan/file-${i}.txt`);
    }

    // 确认 session scope 下不再有 file entry（目录 entry 可能残留，不是本用例关注点）。
    const afterDeleteFiles = await ctx.conn.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vfs_entry WHERE scope_key = ? AND entry_kind = 'file'`,
      [`session:${project.id}:${session.id}`],
    );
    assert.equal(
      Number(afterDeleteFiles[0]!.cnt),
      0,
      "删全部文件后 session scope 下不应再有 file entry",
    );

    // 跑 revision GC：path-scoped 扫不到（entry 已删），靠 deleteGlobalOrphans 兜底。
    const swept = await sweepSessionRevisions(
      revRepo,
      entryRepo,
      checkpointRepo,
      project.id,
      session.id,
      ctx.conn,
    );

    // 触发器已连带回收归零 blob，再跑一次延期 blob GC 兜底（应无残留可清）。
    const gcBlobs = await runDeferredBlobGc(ctx.conn);

    const afterActiveRev = await ctx.conn.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vfs_revision WHERE status='active' AND content_hash IS NOT NULL`,
    );
    const afterBlob = await ctx.conn.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vfs_content_blob`,
    );

    // swept 应包含全部 20 条 active 孤儿 revision（v1 旧版 + v2 旧 head，ref_count 均归 0）。
    assert.ok(
      swept >= totalFiles * 2,
      `sweepSessionRevisions 应清掉至少 ${totalFiles * 2} 条 revision（含全局孤儿），实际 ${swept}`,
    );
    // 核心断言：有 content_hash 的 active revision 全清（之前的 20 条 JOIN 孤儿不再残留）。
    assert.equal(
      Number(afterActiveRev[0]!.cnt),
      0,
      "GC 后有 content_hash 的 active revision 应为 0（孤儿全清）",
    );
    // blob 全清（revision DELETE 触发器连带回收）。
    assert.equal(
      Number(afterBlob[0]!.cnt),
      0,
      "GC 后 vfs_content_blob 应为 0（trigger 连带删）",
    );
    // 延期 GC 兜底应无残留可清。
    assert.equal(
      gcBlobs,
      0,
      "revision GC 已连带回收 blob，延期 blob GC 应无残留",
    );
  });
});
