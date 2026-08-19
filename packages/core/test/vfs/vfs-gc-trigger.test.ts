/**
 * 触发器链路验证测试（Step 16 T-G1 / T-G2）。
 *
 * T-G1（V5）：revision 行被 sweep 删除 → 对应 blob ref_count 递减 → 归零 blob 行被触发器删除 → 无 orphan blob。
 * T-G2（V10）：模板替换链后无 orphan blob。原载体 projectTemplatePull 已随
 * pull 拆除（Step 2）移除：第一例换 sessionTemplatePull 载体，第二例直调
 * replaceVfsSubtree 盯通用 sweep/GC 语义（原「隔离豁免」断言依赖的
 * excludePrefixes:"meta/skills" 语义已随技能重定位消失）。
 *
 * @module test/vfs/vfs-gc-trigger
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTemplatePullService } from "@novel-master/core/workplace";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
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

describe("T-G2: 模板替换链后无 orphan blob（sessionTemplatePull 载体）", () => {
  it("sessionTemplatePull 执行后所有 blob 都被某 revision 引用", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    // project 域源文件 → 创建 session 时初始化拷贝
    const project = await ctx.projects.create(`P-${suffix}`);
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write("/a.md", `A-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // session 独有孤儿文件（会被 replace 删掉，其 blob 应随 sweep 回收）
    await svfs.write("/orphan.md", `orphan-${suffix}`);
    // project 侧更新后 pull：session 树被整体替换
    await pvfs.write("/a.md", `A2-${suffix}`, { versionCheck: false });
    await pvfs.write("/b.md", `B-${suffix}`);

    await createTemplatePullService(ctx.conn).sessionTemplatePull(session.id);

    // 替换后 session 树与 project 快照一致
    const paths = (await svfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, ["/a.md", "/b.md"]);
    assert.equal((await svfs.read("/a.md")).content, `A2-${suffix}`);

    // 替换链后：所有 vfs_content_blob 行必须被某 revision 引用
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )`,
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "sessionTemplatePull 后不应有 orphan blob",
    );
  });

  it("T-G2/sweep：replaceVfsSubtree 后无 orphan blob，前缀外文件 blob ref_count 不变", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    // global 源侧只提供 /repl 子树；project 域前缀外放一个保留文件
    const gvfs = ctx.globalVfs();
    await gvfs.write(`/repl/new-${suffix}.md`, `new-${suffix}`);
    const project = await ctx.projects.create(`P-${suffix}`);
    const projectScope = `project:${project.id}`;
    const pvfs = ctx.projectVfs(project.id);
    await pvfs.write(`/repl/old-${suffix}.md`, `old-${suffix}`);
    await pvfs.write(`/keep/keep-${suffix}.md`, `keep-${suffix}`);

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const newHash = (
      await entryRepo.findContentHash("global", `/repl/new-${suffix}.md`)
    )!;
    const keepHash = (
      await entryRepo.findContentHash(projectScope, `/keep/keep-${suffix}.md`)
    )!;
    const refBefore = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [keepHash],
    );
    assert.equal(
      Number(refBefore[0]!.ref_count),
      1,
      "保留文件 blob 初始 ref_count=1",
    );

    // 直调 replaceVfsSubtree（projectTemplatePull 拆除后的通用 sweep/GC 载体）
    await replaceVfsSubtree(
      entryRepo,
      { scopeKey: "global" },
      "/repl",
      { scopeKey: projectScope },
      "/repl",
      {
        revisions: new SqliteVfsRevisionRepository(ctx.conn),
        contentStore: new SqliteVfsContentStore(ctx.conn),
      },
    );

    // 前缀外保留文件：内容不变，blob 仍被 live head revision 引用，ref_count 不变
    assert.equal(
      (await pvfs.read(`/keep/keep-${suffix}.md`)).content,
      `keep-${suffix}`,
    );

    const keepRefAfter = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [keepHash],
    );
    assert.equal(
      Number(keepRefAfter[0]!.ref_count),
      1,
      "前缀外文件 blob ref_count 不应变化",
    );

    // 替换语义：旧文件 entry 已被删除，新文件已拷入
    const paths = (await pvfs.list("/", { recursive: true }))
      .filter((e) => e.kind === "file")
      .map((e) => e.path)
      .sort();
    assert.deepEqual(paths, [
      `/keep/keep-${suffix}.md`,
      `/repl/new-${suffix}.md`,
    ]);

    // 拷入的新文件：blob 存在且被拷贝侧 revision 引用（源 + 拷贝共享）
    const newBlobRows = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
      [newHash],
    );
    assert.equal(Number(newBlobRows[0]!.ref_count), 2, "新文件 blob 源/拷贝各引用一次");

    // 无 orphan blob（含被替换文件的 blob 已被触发器回收）
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )`,
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "replaceVfsSubtree 后不应有 orphan blob",
    );
  });
});
