/**
 * 触发器链路验证测试（Step 16 T-G1 / T-G2）。
 *
 * T-G1（V5）：revision 行被 sweep 删除 → 对应 blob ref_count 递减 → 归零 blob 行被触发器删除 → 无 orphan blob。
 * T-G2（V10）：模板替换链后无 orphan blob。原载体 projectTemplatePull 已随
 * pull 拆除（Step 2）移除：第一例换 sessionTemplatePull 载体，第二例直调
 * replaceVfsSubtree 盯通用 sweep/GC 语义（原「隔离豁免」断言依赖的
 * excludePrefixes:"meta/skills" 语义已随技能重定位消失）。
 *
 * CR-F06 / CR-F20（并入同一条，本文件补两支牙齿）：
 * ① `T-GC-GUARD-INDEX`：守卫子查询必须走 `idx_vfs_entry_content_hash` 而非
 *    `SCAN vfs_entry`——性能牙齿，光断言「触发器带守卫」不覆盖无索引形态；
 * ② `T-GC-UPGRADE-18-RECLAIM`：第三条升级路径（被撤回的 v18 已把部分库推到
 *    `user_version = 18`，18 >= 18 走快路径 ⇒ 旧名无守卫触发器永远救不回来），
 *    同形于下面的 17 用例，但起点是 18。
 *
 * @module test/vfs/vfs-gc-trigger
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, SCHEMA_BOOT_VERSION } from "@novel-master/core";
import { createTemplatePullService } from "@novel-master/core/workplace";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { replaceVfsSubtree } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { deleteUnreferencedUnderScope } from "@/domain/vfs/logic/revision-ref-count.js";
import {
  VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT,
  VFS_BLOB_GC_TRIGGER_LEGACY_NAMES,
  VFS_BLOB_GC_TRIGGER_NAMES_V2,
  VFS_ENTRY_CONTENT_HASH_INDEX_NAME,
} from "../../src/bootstrap/vfs/vfs-revision-schema.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

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

    // 触发器在 DELETE revision 时判归零 —— 但此刻 /b.md 的 entry 仍在引用该
    // hash（真实 GC 链一律是「先 sweep revision、后删 entry」），守卫因此**不删**。
    // 这是 CS-07 守卫生效后的有意保守方向（宁可留垃圾不可丢数据）：守卫无法
    // 区分「entry 还引用着」与「entry 马上要删」。
    const blobFinal = await ctx.conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );
    assert.equal(
      blobFinal.length,
      1,
      "entry 仍引用该 hash 时，守卫必须阻止归零删除"
    );

    // entry 全部删除后，blob 变成纯垃圾（无 entry、无 revision 都引用它）。
    // 守卫不会主动回收它（触发器只在 revision DELETE 时跑）——这条记为
    // 「存储缓慢增长」的已知限制；测试里显式清掉，避免污染全局 blob 计数。
    await ctx.conn.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash = ?`,
      [blobHash],
    );

    const orphanCount = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )
       AND NOT EXISTS (
         SELECT 1 FROM vfs_entry e WHERE e.content_hash = b.content_hash
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

    // 替换链后：所有 vfs_content_blob 行必须被某 revision 或某 entry 引用
    //（CS-07 守卫生效后，「entry 还在但 revision 已被 sweep」的过渡态 blob
    //   会被有意保留——守卫无法区分它与「entry 马上要删」）。
    const orphanRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob b
       WHERE NOT EXISTS (
         SELECT 1 FROM vfs_revision r WHERE r.content_hash = b.content_hash
       )
       AND NOT EXISTS (
         SELECT 1 FROM vfs_entry e WHERE e.content_hash = b.content_hash
       )`,
    );
    assert.equal(
      Number(orphanRows[0]!.n),
      0,
      "sessionTemplatePull 后不应有既无 revision 也无 entry 引用的 blob",
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

    // CS-07 守卫生效后的口径：blob 的「可读性」由 entry 与 revision **任一**
    // 引用保证。替换链上「先 sweep revision（entry 还在）→ 后删 entry」会留下
    // 一段过渡态 blob，属有意的保守方向（宁可留垃圾不可丢数据），登记为
    // 「存储缓慢增长」已知限制；这里只钉住**仍被本域 entry 引用的 blob 必须
    // 都有 revision 支撑**——否则文件当场不可读。
    const danglingLive = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_entry e
       WHERE e.scope_key = ?
         AND e.entry_kind = 'file'
         AND e.content_hash IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM vfs_revision r
           WHERE r.entry_id = e.entry_id AND r.content_hash = e.content_hash
         )`,
      [projectScope],
    );
    assert.equal(
      Number(danglingLive[0]!.n),
      0,
      "仍被 entry 引用的 blob 必须有 revision 支撑（否则文件不可读）",
    );
  });
});

/**
 * CS-07：blob 归零触发器不感知 `vfs_entry` 引用。
 *
 * 病症：`ref_count` 只由 revision 触发器维护，而 `vfs_entry.content_hash`
 * 这一路引用对触发器完全不可见。只要存在「entry 有 content_hash 但没有对应
 * revision 行」的状态（批量 ingest 绕开 revision 层时造的悬空 head），
 * 该 blob 的 ref_count 常年为 0；此时任何一条引用同 hash 的 revision 被删，
 * 归零判定就把 blob 行删掉 ⇒ 共享该 hash 的另一条 entry `read` 抛
 * 「vfs_content_blob 缺失」，**文件永久不可读**。
 */
describe("CS-07: blob 归零触发器的 vfs_entry 守卫", () => {
  /**
   * 造「entry 引用 H、`vfs_revision` 无 H 的行、blob H 的 ref_count = 0」，
   * 外加一条独立的、引用 H 的 revision 行（删它即可触发 DELETE 触发器）。
   *
   * ⚠️ blob 行**必须先于** entry 行建好：`vfs_entry.content_hash` 指向的行
   * 不存在时，任何读该 entry 的路径都会抛「vfs_content_blob 缺失」。
   */
  async function seedDanglingEntry(
    ctx: ReturnType<typeof getNovelMasterTestContext>,
    body: string,
    suffix: string
  ): Promise<{ hash: string; revisionEntryId: number }> {
    // contentStore.put 负责 encoding/bytes 等列，并给出权威 content_hash
    const hash = await new SqliteVfsContentStore(ctx.conn).put(body);
    const project = await ctx.projects.create(`P-${suffix}`);
    const scope = `project:${project.id}`;
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);

    // 悬空 entry：content_hash = hash，但**没有任何 revision 行**（CS-06 形态）
    await ctx.conn.execute(
      `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
       VALUES (?, ?, 'file', 1, ?, 0)`,
      [scope, `/dangling-${suffix}.md`, hash],
    );
    // 持有点的 entry：带一条引用同 hash 的活 revision（ref_count=1）
    await ctx.conn.execute(
      `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
       VALUES (?, ?, 'file', 1, ?, 0)`,
      [scope, `/holder-${suffix}.md`, hash],
    );
    const holder = await entryRepo.findByPath(scope, `/holder-${suffix}.md`);
    await ctx.conn.execute(
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
       VALUES (?, 1, 'active', 0, ?, 1)`,
      [holder!.entryId, hash],
    );
    return { hash, revisionEntryId: holder!.entryId };
  }

  it("T-GC-GUARD-DELETE: entry 仍引用该 hash 时，删 revision 不得回收 blob", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const { hash, revisionEntryId } = await seedDanglingEntry(
      ctx,
      `guard-body-delete-${suffix}`,
      suffix,
    );

    await ctx.conn.execute(`DELETE FROM vfs_revision WHERE entry_id = ?`, [
      revisionEntryId,
    ]);

    const rows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
      [hash],
    );
    assert.equal(
      Number(rows[0]!.n),
      1,
      "旧触发器下这条必红（blob 被删）；守卫生效时必须仍在",
    );
    await ctx.conn.execute(`DELETE FROM vfs_content_blob WHERE content_hash = ?`, [
      hash,
    ]);
  });

  it("T-GC-GUARD-UPDATE: UPDATE 触发器路径同款守卫（旧 hash 的 blob 不得被回收）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const { hash: oldHash, revisionEntryId } = await seedDanglingEntry(
      ctx,
      `guard-body-update-${suffix}`,
      suffix,
    );
    const newHash = await new SqliteVfsContentStore(ctx.conn).put(
      `guard-body-update-new-${suffix}`,
    );

    await ctx.conn.execute(
      `UPDATE vfs_revision SET content_hash = ? WHERE entry_id = ?`,
      [newHash, revisionEntryId],
    );

    const rows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
      [oldHash],
    );
    assert.equal(
      Number(rows[0]!.n),
      1,
      "`UPDATE OF content_hash` 走的是 UPDATE 触发器那段 DELETE——守卫必须同样生效",
    );
    await ctx.conn.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash IN (?, ?)`,
      [oldHash, newHash],
    );
  });

  it("T-GC-GUARD-NOREGRESS: 无 entry 引用时 blob 仍被回收（防守卫写太宽）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const hash = await new SqliteVfsContentStore(ctx.conn).put(
      `guard-body-noregress-${suffix}`,
    );
    const project = await ctx.projects.create(`P-${suffix}`);
    const scope = `project:${project.id}`;
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    await ctx.conn.execute(
      `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
       VALUES (?, '/lonely.md', 'file', 1, ?, 0)`,
      [scope, hash],
    );
    const entry = await entryRepo.findByPath(scope, "/lonely.md");
    await ctx.conn.execute(
      `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
       VALUES (?, 1, 'active', 0, ?, 1)`,
      [entry!.entryId, hash],
    );
    // 先删 entry（模拟真实链里「entry 已走」的时刻），再删 revision
    await ctx.conn.execute(`DELETE FROM vfs_entry WHERE entry_id = ?`, [
      entry!.entryId,
    ]);
    await ctx.conn.execute(`DELETE FROM vfs_revision WHERE entry_id = ?`, [
      entry!.entryId,
    ]);

    const rows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
      [hash],
    );
    assert.equal(Number(rows[0]!.n), 0, "无 entry 引用时 blob 必须仍被回收");
  });

  it("T-GC-GUARD-BOOTSTRAP: bootstrap 后两个触发器都带守卫，且旧名已不存在", async () => {
    const ctx = getNovelMasterTestContext();

    const triggers = await ctx.conn.query<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`,
    );
    for (const name of VFS_BLOB_GC_TRIGGER_NAMES_V2) {
      const found = triggers.find((t) => t.name === name);
      assert.ok(found != null, `新名触发器应存在：${name}`);
      assert.ok(
        String(found!.sql).includes(VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT),
        `${name} 必须带 vfs_entry 守卫`,
      );
      // 字面量锁（cr1-ctests P2-4b）：上面那条是「用同一真源断言同一真源」——
      // 守卫常量一旦被清空/改名但触发器 SQL 未动，`includes("")` 照样成立，
      // 断言会跟着空转。这里不引用任何常量，直接钉 SQL 里必须字面出现
      // `vfs_entry`（守卫子查询的表名）。
      assert.ok(
        /vfs_entry/i.test(String(found!.sql)),
        `${name} 的触发器 SQL 必须字面提到 vfs_entry（不依赖导出常量）`,
      );
    }

    // ⚠️ 这条才是拦住 P0 的牙齿：「建了新名」不等于「旧名失效」——
    // 只断言「新名已建」在旧代码里同样成立。必须直接断言旧名不在 sqlite_master。
    const legacy = triggers.filter((t) =>
      VFS_BLOB_GC_TRIGGER_LEGACY_NAMES.includes(
        t.name as (typeof VFS_BLOB_GC_TRIGGER_LEGACY_NAMES)[number],
      ),
    );
    assert.deepEqual(
      legacy.map((t) => t.name),
      [],
      "旧名触发器必须已被 DROP——它们在 SQLite 里不会因代码不再引用而消失",
    );
  });

  /**
   * 守卫常量自身的字面量锁（cr1-ctests P2-4b）。
   *
   * 三处 `String(found!.sql).includes(VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT)`
   * 都是「用同一真源断言同一真源」：常量被清空（`""`）或改名时，`includes` 立刻
   * 变成恒真，断言跟着空转，而触发器 SQL 其实一点没变。这条独立钉住「常量非空
   * 且字面提到 `vfs_entry`」，让守卫常量被清空/改名时也能红。
   */
  it("T-GC-GUARD-CONST: 守卫常量非空且字面包含 vfs_entry（防 includes(常量) 空转）", () => {
    assert.ok(
      VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT.length > 0,
      "守卫常量不得被清空——清空后 `sql.includes(常量)` 会恒真，三处断言集体空转",
    );
    assert.ok(
      /vfs_entry/i.test(VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT),
      "守卫常量必须字面提到 vfs_entry（守卫子查询的表名）",
    );
  });

  /**
   * T-GC-GUARD-INDEX：守卫子查询走 `idx_vfs_entry_content_hash`，不全表扫。
   *
   * 这条是**性能牙齿**：光断言「触发器带守卫」不覆盖 `vfs_entry.content_hash`
   * 上无索引的形态，而守卫落在热路径 `sweepRevisionsUnderScope`（会话删除 /
   * 回滚 / releaseAndDeleteVfsPrefix 补偿）——一次删 N 条 revision 就 N 次全表扫
   * `vfs_entry`。守卫子查询在触发体里是字面 SQL，拿不到参数，所以这里照抄触发器
   * 那段 DELETE 逐字 EXPLAIN：SQLite 的查询规划与真实执行同源，plan 变了就该红。
   */
  it("T-GC-GUARD-INDEX: DELETE 触发器的守卫子查询走 idx_vfs_entry_content_hash 而非 SCAN vfs_entry", async () => {
    const ctx = getNovelMasterTestContext();

    // 前置：索引真的建出来了，且形态是部分索引（只收 content_hash 非 NULL 的行）。
    const indexes = await ctx.conn.query<{ name: string; sql: string | null }>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'vfs_entry'`
    );
    const idx = indexes.find((i) => i.name === VFS_ENTRY_CONTENT_HASH_INDEX_NAME);
    assert.ok(
      idx != null,
      `bootstrap 后 ${VFS_ENTRY_CONTENT_HASH_INDEX_NAME} 应存在（缺了守卫就退化成全表扫）`
    );
    assert.match(
      String(idx!.sql),
      /WHERE\s+content_hash\s+IS\s+NOT\s+NULL/i,
      "守卫索引必须是部分索引：content_hash 可空，目录条目恒 NULL"
    );

    // 照抄 VFS_REVISION_DELETE_TRIGGER_DDL 里的那段 DELETE（hash 换成字面量）。
    const probeHash = "0123456789abcdef0123456789abcdef";
    const plan = await ctx.conn.query<{
      id: number;
      parent: number;
      detail: string;
    }>(
      `EXPLAIN QUERY PLAN
       DELETE FROM vfs_content_blob
       WHERE content_hash = '${probeHash}' AND ref_count <= 0
         AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = '${probeHash}')`
    );
    const detail = plan.map((row) => String(row.detail)).join(" | ");
    assert.match(
      detail,
      new RegExp(VFS_ENTRY_CONTENT_HASH_INDEX_NAME),
      `守卫子查询必须走 ${VFS_ENTRY_CONTENT_HASH_INDEX_NAME}，实际 plan：${detail}`
    );
    assert.doesNotMatch(
      detail,
      /SCAN\s+vfs_entry\b/i,
      `守卫子查询不得全表扫 vfs_entry，实际 plan：${detail}`
    );
  });
});

/**
 * 存量库升级路径：user_version 17 → 当前 SCHEMA_BOOT_VERSION。
 *
 * 只断言「bootstrap 后触发器带守卫」是不够的——**快路径**在 bootVersion ≥
 * SCHEMA_BOOT_VERSION 时直接 return，真正决定「老用户能不能被救回来」的是
 * 慢路径里的 DROP + CREATE 组合。本组用独立连接把库压回 17 的形态（v2 触发器
 * 换成**无守卫的旧名**），再跑一次 bootstrap 验三件事：
 * ① v2 存在且带守卫；② 旧名已从 sqlite_master 消失；③ 守卫生效**与**回收两向
 * 都对（既要「不误删」，也要「不漏删」）。
 */
describe("CS-07 存量库升级路径（user_version 17 → SCHEMA_BOOT_VERSION）", () => {
  it("T-GC-UPGRADE-17-18: 旧名无守卫触发器 + v17 库 → bootstrap 后 v2 生效、旧名已 DROP", async () => {
    const ctx = await openNovelMasterTestConnection();
    try {
      // ── 造「user_version = 17 的存量库」形态 ────────────────────────────
      for (const name of VFS_BLOB_GC_TRIGGER_NAMES_V2) {
        await ctx.conn.execute(`DROP TRIGGER IF EXISTS ${name}`);
      }
      // 旧名 DELETE 触发器：**无 vfs_entry 守卫**（这就是 P0 的现场）。
      await ctx.conn.execute(
        `CREATE TRIGGER trg_revision_delete_dec_blob_ref
         AFTER DELETE ON vfs_revision
         WHEN OLD.content_hash IS NOT NULL
         BEGIN
           UPDATE vfs_content_blob SET ref_count = ref_count - 1
           WHERE content_hash = OLD.content_hash;
           DELETE FROM vfs_content_blob
           WHERE content_hash = OLD.content_hash AND ref_count <= 0;
         END`
      );
      // 旧名 UPDATE 触发器：同款无守卫 DELETE。
      await ctx.conn.execute(
        `CREATE TRIGGER trg_revision_update_transfer_blob_ref
         AFTER UPDATE OF content_hash ON vfs_revision
         WHEN OLD.content_hash IS NOT NEW.content_hash
         BEGIN
           UPDATE vfs_content_blob SET ref_count = ref_count - 1
           WHERE content_hash = OLD.content_hash AND OLD.content_hash IS NOT NULL;
           DELETE FROM vfs_content_blob
           WHERE content_hash = OLD.content_hash AND ref_count <= 0
             AND OLD.content_hash IS NOT NULL;
           UPDATE vfs_content_blob SET ref_count = ref_count + 1
           WHERE content_hash = NEW.content_hash AND NEW.content_hash IS NOT NULL;
         END`
      );
      await ctx.conn.execute(`PRAGMA user_version = 17`);

      const beforeTriggers = await ctx.conn.query<{ name: string; sql: string }>(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`
      );
      assert.ok(
        beforeTriggers.some((t) => t.name === "trg_revision_delete_dec_blob_ref"),
        "前置：旧名触发器必须先造出来"
      );
      assert.equal(
        beforeTriggers.find((t) => t.name === "trg_revision_delete_dec_blob_ref")!.sql.includes(
          VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT
        ),
        false,
        "前置：旧名触发器必须**没有**守卫（否则本用例测不到升级）"
      );

      // ── 升级 ──────────────────────────────────────────────────────────
      await bootstrapNovelMaster(ctx.conn);

      // ── ① v2 存在且带守卫 / ② 旧名已 DROP / user_version 已 bump ───────
      const after = await ctx.conn.query<{ name: string; sql: string }>(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`
      );
      for (const name of VFS_BLOB_GC_TRIGGER_NAMES_V2) {
        const found = after.find((t) => t.name === name);
        assert.ok(found != null, `升级后新名触发器应存在：${name}`);
        assert.ok(
          String(found!.sql).includes(VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT),
          `${name} 升级后必须带 vfs_entry 守卫`
        );
      }
      for (const name of VFS_BLOB_GC_TRIGGER_LEGACY_NAMES) {
        assert.ok(
          !after.some((t) => t.name === name),
          `升级后旧名触发器必须已 DROP：${name}`
        );
      }
      const version = await ctx.conn.query<{ user_version: number }>(
        `PRAGMA user_version`
      );
      assert.equal(
        Number(version[0]!.user_version),
        SCHEMA_BOOT_VERSION,
        `user_version 应被 bump 到 ${SCHEMA_BOOT_VERSION}`
      );

      // ── ③ 守卫生效方向：entry 仍引用该 hash ⇒ 删 revision 不得回收 blob ──
      const guardedHash = await new SqliteVfsContentStore(ctx.conn).put(
        `upgrade-guard-${Date.now()}`
      );
      const scope = `project:up-${Date.now()}`;
      await ctx.conn.execute(
        `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
         VALUES (?, '/dangling.md', 'file', 1, ?, 0)`,
        [scope, guardedHash]
      );
      await ctx.conn.execute(
        `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
         VALUES (?, '/holder.md', 'file', 1, ?, 0)`,
        [scope, guardedHash]
      );
      const holder = await new SqliteVfsEntryRepository(ctx.conn).findByPath(
        scope,
        "/holder.md"
      );
      await ctx.conn.execute(
        `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
         VALUES (?, 1, 'active', 0, ?, 1)`,
        [holder!.entryId, guardedHash]
      );
      await ctx.conn.execute(`DELETE FROM vfs_revision WHERE entry_id = ?`, [
        holder!.entryId,
      ]);
      const kept = await ctx.conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [guardedHash]
      );
      assert.equal(
        Number(kept[0]!.n),
        1,
        "升级后守卫必须生效：entry 仍引用该 hash 时 blob 不得被回收"
      );

      // ── ③ 回收方向：entry 已删 ⇒ blob 仍被正常回收（守卫没写太宽）─────
      const freeHash = await new SqliteVfsContentStore(ctx.conn).put(
        `upgrade-free-${Date.now()}`
      );
      await ctx.conn.execute(
        `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
         VALUES (?, '/lonely.md', 'file', 1, ?, 0)`,
        [scope, freeHash]
      );
      const lonely = await new SqliteVfsEntryRepository(ctx.conn).findByPath(
        scope,
        "/lonely.md"
      );
      await ctx.conn.execute(
        `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
         VALUES (?, 1, 'active', 0, ?, 1)`,
        [lonely!.entryId, freeHash]
      );
      await ctx.conn.execute(`DELETE FROM vfs_entry WHERE entry_id = ?`, [
        lonely!.entryId,
      ]);
      await ctx.conn.execute(`DELETE FROM vfs_revision WHERE entry_id = ?`, [
        lonely!.entryId,
      ]);
      const dropped = await ctx.conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [freeHash]
      );
      assert.equal(
        Number(dropped[0]!.n),
        0,
        "升级后回收方向仍要生效：无 entry 引用时 blob 必须被回收"
      );
    } finally {
      await ctx.conn.close();
    }
  });
});

/**
 * 第三条升级路径：**被撤回的 v18 已经把部分库推到 `user_version = 18`**。
 *
 * v18（用量详情弹窗的 `chat_message.tool_use_count`）当日撤回、DDL 全撤，但跑过
 * 它的 feature 分支测试机 / 装过开发版的库 `user_version` 已经是 18。若
 * `SCHEMA_BOOT_VERSION` 停在 18，这批库 `18 >= 18` 走**快路径直接 return**——
 * legacy 无守卫触发器永远不会被 DROP、v2 永远建不出来。文件里那段 v18 注记把它
 * 判成「无害孤儿」，那是对**列**的判断，对**触发器**不成立：触发器缺守卫就是
 * P0 现场（删一条共享 hash 的 revision 就把别的 entry 的 blob 删掉，文件永久不可读）。
 *
 * 前置自证（`SCHEMA_BOOT_VERSION > 18`）是硬门：版本若被改回 18，本用例的前置
 * 根本构造不出来，会退化成 17 用例的同形复制、静默失守。
 */
describe("CS-07 第三条升级路径：被撤回 v18 留下的 user_version = 18 库", () => {
  it("T-GC-UPGRADE-18-RECLAIM: 旧名无守卫触发器 + v18 库 → bootstrap 后 v2 生效、旧名已 DROP", async () => {
    assert.ok(
      SCHEMA_BOOT_VERSION > 18,
      `SCHEMA_BOOT_VERSION 必须 > 18（当前 ${SCHEMA_BOOT_VERSION}）：否则 v18 库走快路径，前置构造不出来`
    );

    const ctx = await openNovelMasterTestConnection();
    try {
      // ── 造「user_version = 18 的存量库」形态 ────────────────────────────
      // 只造**旧名**（v2 名一并 DROP），且旧名**没有** vfs_entry 守卫——这就是 P0 现场。
      for (const name of VFS_BLOB_GC_TRIGGER_NAMES_V2) {
        await ctx.conn.execute(`DROP TRIGGER IF EXISTS ${name}`);
      }
      await ctx.conn.execute(
        `CREATE TRIGGER trg_revision_delete_dec_blob_ref
         AFTER DELETE ON vfs_revision
         WHEN OLD.content_hash IS NOT NULL
         BEGIN
           UPDATE vfs_content_blob SET ref_count = ref_count - 1
           WHERE content_hash = OLD.content_hash;
           DELETE FROM vfs_content_blob
           WHERE content_hash = OLD.content_hash AND ref_count <= 0;
         END`
      );
      // 索引也一并拆掉：v18 形态里它不存在，升级后必须由 canonical DDL 补出来。
      await ctx.conn.execute(
        `DROP INDEX IF EXISTS ${VFS_ENTRY_CONTENT_HASH_INDEX_NAME}`
      );
      await ctx.conn.execute(`PRAGMA user_version = 18`);

      const before = await ctx.conn.query<{
        name: string;
        sql: string | null;
      }>(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`);
      assert.ok(
        before.some((t) => t.name === "trg_revision_delete_dec_blob_ref"),
        "前置：旧名触发器必须先造出来"
      );
      assert.equal(
        before.find((t) => t.name === "trg_revision_delete_dec_blob_ref")!.sql!.includes(
          VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT
        ),
        false,
        "前置：旧名触发器必须**没有**守卫（否则本用例测不到升级）"
      );

      // ── 升级 ──────────────────────────────────────────────────────────
      await bootstrapNovelMaster(ctx.conn);

      // ── ① v2 存在且带守卫 / ② 旧名已 DROP / user_version 已 bump ───────
      const after = await ctx.conn.query<{ name: string; sql: string | null }>(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`
      );
      for (const name of VFS_BLOB_GC_TRIGGER_NAMES_V2) {
        const found = after.find((t) => t.name === name);
        assert.ok(found != null, `升级后新名触发器应存在：${name}`);
        assert.ok(
          String(found!.sql).includes(VFS_BLOB_GC_ENTRY_GUARD_SQL_FRAGMENT),
          `${name} 升级后必须带 vfs_entry 守卫`
        );
      }
      for (const name of VFS_BLOB_GC_TRIGGER_LEGACY_NAMES) {
        assert.ok(
          !after.some((t) => t.name === name),
          `升级后旧名触发器必须已 DROP：${name}`
        );
      }
      const version = await ctx.conn.query<{ user_version: number }>(
        `PRAGMA user_version`
      );
      assert.equal(
        Number(version[0]!.user_version),
        SCHEMA_BOOT_VERSION,
        `user_version 应被 bump 到 ${SCHEMA_BOOT_VERSION}`
      );

      // ── ③ 守卫生效方向：entry 仍引用该 hash ⇒ 删 revision 不得回收 blob ──
      const guardedHash = await new SqliteVfsContentStore(ctx.conn).put(
        `reclaim-guard-${Date.now()}`
      );
      const scope = `project:reclaim-${Date.now()}`;
      await ctx.conn.execute(
        `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
         VALUES (?, '/dangling.md', 'file', 1, ?, 0)`,
        [scope, guardedHash]
      );
      await ctx.conn.execute(
        `INSERT INTO vfs_entry (scope_key, path, entry_kind, head_version, content_hash, mtime_ms)
         VALUES (?, '/holder.md', 'file', 1, ?, 0)`,
        [scope, guardedHash]
      );
      const holder = await new SqliteVfsEntryRepository(ctx.conn).findByPath(
        scope,
        "/holder.md"
      );
      await ctx.conn.execute(
        `INSERT INTO vfs_revision (entry_id, version, status, mtime_ms, content_hash, ref_count)
         VALUES (?, 1, 'active', 0, ?, 1)`,
        [holder!.entryId, guardedHash]
      );
      await ctx.conn.execute(`DELETE FROM vfs_revision WHERE entry_id = ?`, [
        holder!.entryId,
      ]);
      const kept = await ctx.conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
        [guardedHash]
      );
      assert.equal(
        Number(kept[0]!.n),
        1,
        "升级后守卫必须生效：entry 仍引用该 hash 时 blob 不得被回收"
      );

      // ── ④ 守卫索引必须同批补出（v18 形态里没有，靠慢路径 canonical DDL）──
      const indexes = await ctx.conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'vfs_entry'`
      );
      assert.ok(
        indexes.some((i) => i.name === VFS_ENTRY_CONTENT_HASH_INDEX_NAME),
        `升级后 ${VFS_ENTRY_CONTENT_HASH_INDEX_NAME} 必须存在（守卫子查询否则全表扫）`
      );
    } finally {
      await ctx.conn.close();
    }
  });
});
