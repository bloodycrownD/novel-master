/**
 * 触发器链路验证测试（Step 16 T-G1 / T-G2）。
 *
 * T-G1（V5）：revision 行被 sweep 删除 → 对应 blob ref_count 递减 → 归零 blob 行被触发器删除 → 无 orphan blob。
 * T-G2（V10）：projectTemplatePull 执行后无 orphan blob。
 *
 * @module test/vfs/vfs-gc-trigger
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTemplatePullService,
  type TemplatePullService,
} from "@novel-master/core/workplace";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { deleteUnreferencedUnderScope } from "@/domain/vfs/logic/revision-ref-count.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("T-G1: sweep 删除 revision → 触发器自动回收 orphan blob", () => {
  it("删除 revision 后 ref_count 递减，归零 blob 行被触发器自动删", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-${suffix}`);
    const pvfs = ctx.projectVfs(project.id);

    // 写两个文件共用同一内容（共享 blob）
    await pvfs.write("/a.md", "hello gc test");
    await pvfs.write("/b.md", "hello gc test");

    // 查 entry repo 拿 entry_id
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const scopeKey = `project:${project.id}`;
    const entryA = await entryRepo.findByPath(scopeKey, "/a.md");
    const entryB = await entryRepo.findByPath(scopeKey, "/b.md");
    assert.ok(entryA != null);
    assert.ok(entryB != null);

    // 拿到 blob hash
    const contentStore = new SqliteVfsContentStore(ctx.conn);
    const blobHash = await contentStore.put("hello gc test");

    // 两个文件各有一条 revision，vfs_content_blob.ref_count = 2
    const blobBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(Number(blobBefore[0]!.ref_count), 2, "初始 ref_count 应为 2");

    // deleteUnreferencedUnderScope JOIN vfs_entry 圈定范围，
    // 所以必须先 decrement ref + sweep（entry 还在），最后才删 entry。
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    // Step 1：/a.md 的 vfs_revision.ref_count 降到 0 → sweep 删 revision → 删 entry
    const aRev = await revisionRepo.findMaxVersionForEntry(entryA.entryId);
    assert.ok(aRev != null);
    await revisionRepo.adjustRefCount(entryA.entryId, aRev, -1);

    const deleted = await deleteUnreferencedUnderScope(revisionRepo, scopeKey, "/");
    assert.ok(deleted >= 1, "ref_count 归零的 revision 应被 sweep 删除");

    // 现在 entry 可安全删
    await entryRepo.delete(scopeKey, "/a.md", { recursive: false });

    // 触发器 trg_revision_delete_dec_blob_ref 已触发：vfs_content_blob.ref_count 从 2 到 1
    const blobMid = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(Number(blobMid[0]!.ref_count), 1, "删除一条 revision 后 ref_count 应为 1");

    // blob 行仍在（/b.md 的 revision 还引用它）
    const blobExists = await ctx.conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(blobExists.length, 1, "还有 revision 引用时 blob 行应保留");

    // Step 2：/b.md 的 vfs_revision.ref_count 降到 0 → sweep → 删 entry → blob 归零自动删
    const bRev = await revisionRepo.findMaxVersionForEntry(entryB.entryId);
    assert.ok(bRev != null);
    await revisionRepo.adjustRefCount(entryB.entryId, bRev, -1);

    const deleted2 = await deleteUnreferencedUnderScope(revisionRepo, scopeKey, "/");
    assert.ok(deleted2 >= 1, "第二条 revision 也应被 sweep 删除");
    await entryRepo.delete(scopeKey, "/b.md", { recursive: false });

    // 触发器在 DELETE revision 时自动删归零 blob
    const blobFinal = await ctx.conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(blobFinal.length, 0, "ref_count 归零后 blob 行应被触发器自动删除");

    // 无 orphan blob
    const orphanCount = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )`,
    );
    assert.equal(Number(orphanCount[0]!.n), 0, "不应有 orphan blob");
  });
});

describe("T-G2: projectTemplatePull 后无 orphan blob", () => {
  it("projectTemplatePull 执行后所有 blob 都被某 revision 引用", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    // 通过 entry repo 直接在 global scope 的 /template 前缀下写文件
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const gvfs = ctx.globalVfs();
    await gvfs.write("/template-a.md", "template content A");
    await gvfs.write("/template-b.md", "template content B");

    // 用 entry repo 将文件移到 /template 下（绕过 ScopedVfsService 的路径检查）
    const entryA = await entryRepo.findByPath("global", "/template-a.md");
    const entryB = await entryRepo.findByPath("global", "/template-b.md");
    assert.ok(entryA != null);
    assert.ok(entryB != null);
    await ctx.conn.execute(
      `UPDATE vfs_entry SET path = '/template/template-a.md' WHERE entry_id = ?`,
      [entryA.entryId],
    );
    await ctx.conn.execute(
      `UPDATE vfs_entry SET path = '/template/template-b.md' WHERE entry_id = ?`,
      [entryB.entryId],
    );

    const project = await ctx.projects.create(`P-${suffix}`);

    // 在项目 scope 写文件（会被 template pull 覆盖）
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", "project content A");

    // 执行 projectTemplatePull（会 replaceVfsSubtree → 删旧 + 拷贝 template）
    const pull: TemplatePullService = createTemplatePullService(ctx.conn);
    await pull.projectTemplatePull(project.id);

    // projectTemplatePull 后: 所有 vfs_content_blob 行必须被某 revision 引用
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )`,
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "projectTemplatePull 后不应有 orphan blob",
    );
  });
});
