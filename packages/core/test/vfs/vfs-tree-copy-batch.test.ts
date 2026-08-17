/**
 * tree-copy 批量快慢路径直接单测：
 *
 * - T-BATCH-1 快路径：project scope → session scope 一次 replaceVfsSubtree，
 *   断言目标 entry content_hash 正确、共享 blob ref_count = 2（源 revision 1 + 目标种子 revision 1）。
 * - T-BATCH-2 慢路径 / 缺失 blob：删除某 blob 行后再 copy，走慢路径失败
 *   （scanContents 或 ensureBlob 抛错），且事务回滚、目标 scope 不落半套 entry。
 * - T-BATCH-3 seed 批量：replaceVfsSubtree 后 target 每文件恰好 1 条 revision（ref_count=1），
 *   重复 seed 幂等（第二次返回 0、不重复 +1 blob ref_count）。
 * - T-BATCH-4 ensureBlob 合同：blob 缺失且无可回退明文时抛错。
 *
 * @module test/vfs/vfs-tree-copy-batch
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { seedLiveHeadRevisionsUnderPrefix } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 查询 blob 行 ref_count。 */
async function blobRefCount(contentHash: string): Promise<number> {
  const ctx = getNovelMasterTestContext();
  const rows = await ctx.conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
    [contentHash],
  );
  assert.equal(rows.length, 1, `blob 行应存在: ${contentHash}`);
  return Number(rows[0]!.ref_count);
}

describe("replaceVfsSubtree 快慢路径 / copyVfsTree 批量", () => {
  it("T-BATCH-1 快路径：project → session 拷贝，content_hash 正确且共享 blob ref_count=2", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    const projectVfs = ctx.projectVfs(project.id);
    // 三份本文互不相同，各自共享 blob 只在「源 + 目标」各被一条 revision 引用 → ref_count=2
    await projectVfs.write("/shared.txt", `shared-${suffix}`);
    await projectVfs.write("/other.txt", `other-${suffix}`);
    await projectVfs.mkdir("/sub");
    await projectVfs.write("/sub/nested.txt", `nested-${suffix}`);

    const projectScope = `project:${project.id}`;
    const sessionScope = `session:${project.id}:${session.id}`;
    const hashShared = hashContent(`shared-${suffix}`);
    const hashOther = hashContent(`other-${suffix}`);
    const hashNested = hashContent(`nested-${suffix}`);

    await ctx.conn.transaction(async (tx) => {
      const vfs = new SqliteVfsEntryRepository(tx);
      const revisions = new SqliteVfsRevisionRepository(tx);
      await replaceVfsSubtree(
        vfs,
        { scopeKey: projectScope },
        "/",
        { scopeKey: sessionScope },
        "/",
        { revisions, contentStore: new SqliteVfsContentStore(tx) },
      );
    });

    // 目标 entry：content_hash 与源一致
    const vfsCheck = new SqliteVfsEntryRepository(ctx.conn);
    assert.equal(
      (await vfsCheck.findContentHash(sessionScope, "/shared.txt"))!,
      hashShared,
    );
    assert.equal(
      (await vfsCheck.findContentHash(sessionScope, "/other.txt"))!,
      hashOther,
    );
    assert.equal(
      (await vfsCheck.findContentHash(sessionScope, "/sub/nested.txt"))!,
      hashNested,
    );

    // 共享 blob：源+目标 各一条 revision 引用 → ref_count = 2
    // 源 write 时各 append 1 条 revision；replaceVfsSubtree 为目标文件各 seed 1 条 revision。
    assert.equal(await blobRefCount(hashShared), 2);
    assert.equal(await blobRefCount(hashOther), 2);
    assert.equal(await blobRefCount(hashNested), 2);
  });

  it("T-BATCH-2 缺失 blob：慢路径失败且事务回滚，目标不落半套 entry", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    const projectVfs = ctx.projectVfs(project.id);
    await projectVfs.write("/a.txt", `a-${suffix}`);
    await projectVfs.write("/b.txt", `b-${suffix}`);

    const projectScope = `project:${project.id}`;
    const sessionScope = `session:${project.id}:${session.id}`;
    const hashA = hashContent(`a-${suffix}`);

    // 第一次正常拷贝（源→目标）
    await ctx.conn.transaction(async (tx) => {
      const vfs = new SqliteVfsEntryRepository(tx);
      const revisions = new SqliteVfsRevisionRepository(tx);
      await replaceVfsSubtree(
        vfs,
        { scopeKey: projectScope },
        "/",
        { scopeKey: sessionScope },
        "/",
        { revisions, contentStore: new SqliteVfsContentStore(tx) },
      );
    });

    // 手动删掉 /a.txt 的 blob 行，破坏源侧可回退明文
    await ctx.conn.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash = ?`,
      [hashA],
    );

    // 第二次 replace（走慢路径）：scanContents/ensureBlob 缺失即抛，事务应回滚
    await assert.rejects(
      () =>
        ctx.conn.transaction(async (tx) => {
          const vfs = new SqliteVfsEntryRepository(tx);
          await replaceVfsSubtree(
            vfs,
            { scopeKey: projectScope },
            "/",
            { scopeKey: sessionScope },
            "/",
            {
              contentStore: new SqliteVfsContentStore(tx),
            },
          );
        }),
    );

    // 事务回滚：第二次 replace 先删目标又拷贝失败，整体应回滚到第一次拷贝的完整状态
    const vfsCheck = new SqliteVfsEntryRepository(ctx.conn);
    assert.equal(
      (await vfsCheck.findContentHash(sessionScope, "/a.txt"))!,
      hashA,
      "回滚后 /a.txt 应保留（带正文 hash，而非半套缺失）",
    );
    assert.equal(
      (await vfsCheck.findContentHash(sessionScope, "/b.txt"))!,
      hashContent(`b-${suffix}`),
      "回滚后 /b.txt 应保留",
    );
    // 回滚后已删的 blob 行仍保持缺失（未因拷贝把脏 hash 拉回来）
    const rows = await ctx.conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = ?`,
      [hashA],
    );
    assert.equal(rows.length, 0);
  });

  it("T-BATCH-3 seed 批量：首遍每文件 1 条 revision（ref_count=1），二遍幂等返回 0 且不重复 +1 blob", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    const projectVfs = ctx.projectVfs(project.id);
    await projectVfs.write("/a.txt", `a-${suffix}`);
    await projectVfs.write("/b.txt", `b-${suffix}`);
    const projectScope = `project:${project.id}`;
    const sessionScope = `session:${project.id}:${session.id}`;
    await ctx.conn.transaction(async (tx) => {
      const vfs = new SqliteVfsEntryRepository(tx);
      const revisions = new SqliteVfsRevisionRepository(tx);
      await replaceVfsSubtree(
        vfs,
        { scopeKey: projectScope },
        "/",
        { scopeKey: sessionScope },
        "/",
        { revisions, contentStore: new SqliteVfsContentStore(tx) },
      );
    });

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const heads = await entries.listFileHeadsUnderPrefix(sessionScope, "/");
    assert.equal(heads.length, 2);

    // 目标 scope 每文件恰 1 条 revision，且 ref_count=1
    for (const head of heads) {
      const keys = await revisionRepo.listKeysUnderScope(sessionScope, "/");
      const versions = keys.filter((k): boolean => k.entryId === head.entryId);
      assert.equal(versions.length, 1, `entry ${head.entryId} 应有 1 条 revision`);
      const meta = await revisionRepo.findMetaByEntryAndVersion(
        head.entryId,
        head.headVersion,
      );
      assert.ok(meta);
      const existing = await revisionRepo.findExistingEntryVersionKeys([
        { entryId: head.entryId, version: head.headVersion },
      ]);
      assert.ok(existing.has(`${head.entryId}:${head.headVersion}`));
    }

    const blobAE = await entries.findContentHash(sessionScope, "/a.txt");
    const beforeRef = await blobRefCount(blobAE!);

    // 二遍 seed：已存在 (entryId, version) 的 revision 应跳过 → 返回 0，blob ref_count 不变
    const reseeded = await seedLiveHeadRevisionsUnderPrefix(
      entries,
      revisionRepo,
      sessionScope,
      "/",
    );
    assert.equal(reseeded, 0);
    assert.equal(await blobRefCount(blobAE!), beforeRef);
  });

  it("T-BATCH-4 ensureBlob：blob 缺失且无可回退明文时抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(ctx.conn);
    const plain = `ghost-${testIsolationSuffix()}`;
    const hash = await store.put(plain);
    // 删除后 ensureBlob(缺, null) 必须抛
    await ctx.conn.execute(`DELETE FROM vfs_content_blob WHERE content_hash = ?`, [hash]);
    await assert.rejects(() => store.ensureBlob(hash, null), /vfs_content_blob 缺失且无可回退明文/);
    // 有明文时回退 put 应恢复成功
    await assert.doesNotReject(() => store.ensureBlob(hash, plain));
    assert.equal(await store.get(hash), plain);
  });
});

/** 查询指定 entry 的全部 revision（version → ref_count）。 */
async function revisionRefCounts(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  entryId: number,
): Promise<Map<number, number>> {
  const rows = await ctx.conn.query<{ version: number; ref_count: number }>(
    `SELECT version, ref_count FROM vfs_revision WHERE entry_id = ? ORDER BY version`,
    [entryId],
  );
  return new Map(rows.map((r) => [Number(r.version), Number(r.ref_count)]));
}

describe("replaceVfsSubtree excludePrefixes（隔离豁免，T-SK1）", () => {
  it("T-EXCL-1 删除侧：排除前缀下 entry 不删、revision/ref_count 不变，其余照常替换", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const projectScope = `project:${project.id}`;

    const pvfs = ctx.projectVfs(project.id);
    // 技能文件写两次 → v1 ref_count=0（历史旧版）+ v2 ref_count=1（live head）
    const skillPath = "/meta/skills/foo/SKILL.md";
    await pvfs.write(skillPath, `skill-v1-${suffix}`);
    await pvfs.write(skillPath, `skill-v2-${suffix}`, { versionCheck: false });
    await pvfs.write("/p.md", `p-${suffix}`);

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const skillEntry = await entryRepo.findByPath(projectScope, skillPath);
    assert.ok(skillEntry != null);
    const refsBefore = await revisionRefCounts(ctx, skillEntry.entryId);
    assert.equal(refsBefore.size, 2, "技能文件应有 v1/v2 两条 revision");
    assert.equal(refsBefore.get(1), 0);
    assert.equal(refsBefore.get(2), 1);
    const skillHash = hashContent(`skill-v2-${suffix}`);
    assert.equal(await blobRefCount(skillHash), 1, "live head revision 引用技能 blob");

    // global 模板不含 meta/skills，replace 后其余路径照常被替换
    await ctx.globalVfs().write(`/g-${suffix}.md`, `g-${suffix}`);
    await ctx.conn.transaction(async (tx) => {
      await replaceVfsSubtree(
        new SqliteVfsEntryRepository(tx),
        { scopeKey: "global" },
        "/",
        { scopeKey: projectScope },
        "/",
        {
          revisions: new SqliteVfsRevisionRepository(tx),
          contentStore: new SqliteVfsContentStore(tx),
          excludePrefixes: ["meta/skills"],
        },
      );
    });

    // 排除前缀：entry 保留、内容不变、revision/ref_count 不变
    const skillAfter = await entryRepo.findByPath(projectScope, skillPath);
    assert.ok(skillAfter != null, "排除前缀下 entry 不应被删除");
    assert.equal(
      await entryRepo.findContentHash(projectScope, skillPath),
      skillHash,
      "技能文件内容应保持不变",
    );
    assert.deepEqual(
      await revisionRefCounts(ctx, skillEntry.entryId),
      refsBefore,
      "排除前缀下 revision 行与 ref_count 应完全不变（含 ref_count=0 的历史旧版不被 GC）",
    );
    assert.equal(await blobRefCount(skillHash), 1, "技能 blob 的 ref_count 不应变化");

    // 其余路径照常替换：/p.md 被删、/g.md 被拷入并 seed
    assert.equal(await entryRepo.findByPath(projectScope, "/p.md"), null, "/p.md 应被替换删除");
    assert.ok(
      await entryRepo.findByPath(projectScope, `/g-${suffix}.md`),
      "非排除前缀的文件应被拷入",
    );
  });

  it("T-EXCL-2 拷贝侧：源 scope 排除前缀下条目不随拷贝镜像到目标", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const projectScope = `project:${project.id}`;

    // global 技能域有内容：拷贝时不应镜像到 project（write 自动建父目录链）
    const gvfs = ctx.globalVfs();
    await gvfs.write(`/g-${suffix}.md`, `g-${suffix}`);
    await gvfs.write(`/meta/skills-${suffix}/bar/SKILL.md`, `bar-${suffix}`);
    await gvfs.write(`/meta/skills-${suffix}/bar/references/timeline.md`, `timeline-${suffix}`);

    await ctx.conn.transaction(async (tx) => {
      await replaceVfsSubtree(
        new SqliteVfsEntryRepository(tx),
        { scopeKey: "global" },
        "/",
        { scopeKey: projectScope },
        "/",
        {
          revisions: new SqliteVfsRevisionRepository(tx),
          contentStore: new SqliteVfsContentStore(tx),
          excludePrefixes: [`meta/skills-${suffix}`],
        },
      );
    });

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const paths = await entryRepo.listAllPaths(projectScope);
    assert.ok(
      paths.every((p) => !p.startsWith(`/meta/skills-${suffix}`)),
      `project 不应镜像 global 技能目录，实际：${paths.join(", ")}`,
    );
    assert.ok(
      paths.includes(`/g-${suffix}.md`),
      "非排除前缀的文件应照常拷贝",
    );
  });

  it("T-EXCL-3 seed 侧：排除前缀下缺失的 head revision 不被补种，其余照常补种", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const projectScope = `project:${project.id}`;

    const pvfs = ctx.projectVfs(project.id);
    const skillPath = "/meta/skills/foo/SKILL.md";
    await pvfs.write(skillPath, `skill-${suffix}`);
    // 对照文件写在 global 源：replace 后会被删除重拷（新 entry）并 seed
    const keepPath = `/keep-${suffix}.md`;
    await ctx.globalVfs().write(keepPath, `keep-${suffix}`);

    // 人为删掉技能文件的 head revision，模拟排除前缀下 head revision 意外缺失
    // （不动 global 对照文件，避免破坏源侧 blob 链）
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const skillEntry = await entryRepo.findByPath(projectScope, skillPath);
    assert.ok(skillEntry != null);
    await ctx.conn.execute(`DELETE FROM vfs_revision WHERE entry_id = ?`, [
      skillEntry.entryId,
    ]);

    await ctx.globalVfs().write(`/g-${suffix}.md`, `g-${suffix}`);
    await ctx.conn.transaction(async (tx) => {
      await replaceVfsSubtree(
        new SqliteVfsEntryRepository(tx),
        { scopeKey: "global" },
        "/",
        { scopeKey: projectScope },
        "/",
        {
          revisions: new SqliteVfsRevisionRepository(tx),
          contentStore: new SqliteVfsContentStore(tx),
          excludePrefixes: ["meta/skills"],
        },
      );
    });

    // /keep.md 被 sweep（删除+重拷）后 seed 补种（重拷后是新 entry，需重查）；
    // 排除前缀下的技能 entry 未被触碰，其缺失的 head revision 也不补种（seed 随排除跳过）。
    // 注意：技能的 blob 已随人为删 revision 被触发器回收，findByPath 解明文会抛，
    // 改用 SQL 直查 entry 行。
    const keepEntryAfter = await entryRepo.findByPath(projectScope, keepPath);
    assert.ok(keepEntryAfter != null);
    const keepRefs = await revisionRefCounts(ctx, keepEntryAfter.entryId);
    assert.ok(keepRefs.size >= 1, "/keep.md 重拷后 head revision 应被 seed");
    const skillRefs = await revisionRefCounts(ctx, skillEntry.entryId);
    assert.equal(
      skillRefs.size,
      0,
      "排除前缀下缺失的 head revision 不应被补种",
    );
    const skillRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [projectScope, skillPath],
    );
    assert.equal(Number(skillRows[0]!.n), 1, "技能 entry 本身应保留");
  });

  it("T-EXCL-4 默认不传 excludePrefixes 时行为不变（排除前缀下条目照常替换）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`p-${suffix}`);
    const projectScope = `project:${project.id}`;

    const pvfs = ctx.projectVfs(project.id);
    const skillPath = "/meta/skills/foo/SKILL.md";
    await pvfs.write(skillPath, `skill-${suffix}`);
    await pvfs.write("/p.md", `p-${suffix}`);
    await ctx.globalVfs().write(`/g-${suffix}.md`, `g-${suffix}`);

    await ctx.conn.transaction(async (tx) => {
      await replaceVfsSubtree(
        new SqliteVfsEntryRepository(tx),
        { scopeKey: "global" },
        "/",
        { scopeKey: projectScope },
        "/",
        {
          revisions: new SqliteVfsRevisionRepository(tx),
          contentStore: new SqliteVfsContentStore(tx),
        },
      );
    });

    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    assert.equal(
      await entryRepo.findByPath(projectScope, skillPath),
      null,
      "不传 excludePrefixes 时排除前缀下条目应照常被删除（现行为不变）",
    );
    assert.equal(await entryRepo.findByPath(projectScope, "/p.md"), null);
    assert.ok(await entryRepo.findByPath(projectScope, `/g-${suffix}.md`));
  });
});
