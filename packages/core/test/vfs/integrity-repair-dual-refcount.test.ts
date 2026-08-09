/**
 * T-SC5（Step 20 / S-8）：双引用计数器裁决——触发器路径与应用层路径不重复计数。
 *
 * 验证要点：
 * - `createRevisionRefCountRepairOperation` 的 repair 只上调 `vfs_revision.ref_count`；
 * - repair 过程中 `vfs_content_blob.ref_count` 保持不变（UPDATE 触发器是
 *   `AFTER UPDATE OF content_hash`，而 `repairRefCountFloor` 只动 `ref_count` 列，
 *   触发器不会 fire，所以应用层修复不会顺带 bump blob 侧计数器）；
 * - detect 在有 revision 行时保守标记 needsRepair=true，空 scope 时 false。
 *
 * 同文件还覆盖 vfs repair op 的端到端：手动制造 ref_count 偏低 → repair → 上调复原。
 *
 * @module test/vfs/integrity-repair-dual-refcount
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRevisionRefCountRepairOperation,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("T-SC5: 双引用计数器裁决（vfs_revision vs vfs_content_blob）", () => {
  it("repair 只上调 vfs_revision.ref_count，不碰 blob 侧触发器计数", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    const pvfs = ctx.projectVfs(project.id);

    // 写一个文件 → 产生一条 revision + 一个 blob，blob.ref_count = 1
    await pvfs.write("/dual.md", "shared-content");

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    const scopeKey = `project:${project.id}`;
    const entry = await entryRepo.findByPath(scopeKey, "/dual.md");
    assert.ok(entry != null);
    const version = await revisionRepo.findMaxVersionForEntry(entry.entryId);
    assert.ok(version != null);

    // 读出 blob hash（revision 行的 content_hash 指向它）
    const revMeta = await revisionRepo.findMetaByEntryAndVersion(
      entry.entryId,
      version,
    );
    assert.ok(revMeta?.contentHash != null);
    const blobHash = revMeta!.contentHash!;

    const blobRefCountBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(
      Number(blobRefCountBefore[0]!.ref_count),
      1,
      "初始 blob ref_count 应为 1（一条 revision 引用）",
    );

    // 手动把 vfs_revision.ref_count 压低（模拟 drift）
    await ctx.conn.execute(
      `UPDATE vfs_revision SET ref_count = 0 WHERE entry_id = ? AND version = ?`,
      [entry.entryId, version],
    );
    // 注意：上面这条 UPDATE 只动 ref_count 列，不碰 content_hash，
    // 所以 AFTER UPDATE OF content_hash 触发器不会 fire——blob.ref_count 不变。
    const blobAfterLower = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(
      Number(blobAfterLower[0]!.ref_count),
      1,
      "压低 ref_count 时 blob 侧不应变（触发器未 fire）",
    );

    // 跑 repair 操作：detect → repair
    const op = createRevisionRefCountRepairOperation({
      revisionRepo,
      entryRepo,
      checkpoints: checkpointRepo,
      scopeKey,
      pathPrefix: "/",
      sessionId: "",
    });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, true, "有 revision 行时应保守标记需修复");

    await op.repair();

    // vfs_revision.ref_count 被上调复原（live head 指向它 → expected ≥ 1）
    const revAfter = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entry.entryId, version],
    );
    assert.ok(
      Number(revAfter[0]!.ref_count) >= 1,
      "repair 后 vfs_revision.ref_count 应被上调复原",
    );

    // 关键断言：blob 侧 ref_count 全程不变——应用层修复没有重复计数
    const blobAfterRepair = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(
      Number(blobAfterRepair[0]!.ref_count),
      1,
      "repair 全程 blob ref_count 不应变（触发器路径与应用层路径不重复计数）",
    );
  });

  it("detect 在空 scope（无 revision 行）时返回 needsRepair=false", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-empty-${suffix}`);

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);

    const op = createRevisionRefCountRepairOperation({
      revisionRepo,
      entryRepo,
      checkpoints: checkpointRepo,
      scopeKey: `project:${project.id}`,
      pathPrefix: "/",
      sessionId: "",
    });

    const detection = await op.detect();
    assert.equal(detection.needsRepair, false);
  });

  it("多次跑 repair 幂等，blob ref_count 仍不变", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-idem-${suffix}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/idem.md", "idem-content");

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    const scopeKey = `project:${project.id}`;
    const entry = await entryRepo.findByPath(scopeKey, "/idem.md");
    assert.ok(entry != null);
    const version = await revisionRepo.findMaxVersionForEntry(entry.entryId);
    assert.ok(version != null);
    const revMeta = await revisionRepo.findMetaByEntryAndVersion(
      entry.entryId,
      version,
    );
    const blobHash = revMeta!.contentHash!;

    const op = createRevisionRefCountRepairOperation({
      revisionRepo,
      entryRepo,
      checkpoints: checkpointRepo,
      scopeKey,
      pathPrefix: "/",
      sessionId: "",
    });

    // 连跑三次 repair
    await op.repair();
    await op.repair();
    await op.repair();

    const blobFinal = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(
      Number(blobFinal[0]!.ref_count),
      1,
      "多次幂等 repair 后 blob ref_count 仍应为 1",
    );
  });
});
