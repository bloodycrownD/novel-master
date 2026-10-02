/**
 * N-P1-01：项目删除泄漏一批 `vfs_revision` 行及其 blob（live-head 口径）。
 *
 * 病症：`ProjectService.delete` 对项目自身的两个 VFS scope
 * （`project:{id}` / `project:{id}:meta`）只调了裸 `deleteVfsPrefix`——
 * 它只删 `vfs_entry` 行，既不释放 live-head 引用、也不 GC revision。
 * 而 `ProjectService.copy` 会在这两个 scope 下种下 `ref_count = 1` 的
 * live-head revision（`seedLiveHeadRevisionsUnderPrefix`）。
 *
 * ⇒ entry 已删、revision 的 ref_count 永远停在 1，两条 GC 路径都选不中它：
 * - `deleteUnreferencedUnderScope` 靠 `JOIN vfs_entry` 圈范围 → JOIN 命中 0 行；
 * - 全局兜底 `deleteGlobalOrphans` 只清 `ref_count <= 0` 的 JOIN 孤儿 → 谓词不选。
 * 每「种下一次 live-head revision 再删除该项目」一轮就永久泄漏一批 revision 行
 * + 其 `vfs_content_blob`，无自愈路径。
 *
 * 修法：两个 scope 改走 `sweepRevisionsUnderScope`（decrement → GC → 删 entry）。
 * 会话 scope 的 `deleteVfsPrefix` 必须保持裸调用（live ref 已由
 * `deleteSessionFsData` 释放，再 decrement 一次会撞 CHECK (ref_count >= 0)
 * 导致整个 delete 事务回滚）——P-D4 钉这条。
 *
 * 与 `read-ref-count.test.ts` 的项目删除用例**分开文件**：那边断言的是 read
 * 引用口径，与本条的 live-head 口径共用一份夹具会互相干扰。
 *
 * @module test/vfs/project-delete-revision-gc
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** (entryId, version) 对应的 vfs_revision 行数。 */
async function revisionRowCount(
  entryId: number,
  version: number
): Promise<number> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version],
  );
  return Number(rows[0]!.n);
}

/** scope 下的 vfs_entry 行数。 */
async function entryRowCount(scopeKey: string): Promise<number> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM vfs_entry WHERE scope_key = ?`,
    [scopeKey],
  );
  return Number(rows[0]!.n);
}

/** entryId 下全部 revision 的 (version, ref_count) 映射（用于深比对）。 */
async function revisionRefCounts(
  entryId: number
): Promise<Array<[number, number]>> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ version: number; ref_count: number }>(
    `SELECT version, ref_count FROM vfs_revision WHERE entry_id = ? ORDER BY version`,
    [entryId],
  );
  return rows.map((r) => [Number(r.version), Number(r.ref_count)]);
}

/** blob 行当前的 ref_count（行不存在返回 -1，便于断言「恰好 −1」）。 */
async function blobRefCount(contentHash: string): Promise<number> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
    [contentHash],
  );
  return rows.length === 0 ? -1 : Number(rows[0]!.ref_count);
}

describe("N-P1-01: 项目删除必须回收 project / project:meta 两个 scope 的 live-head revision", () => {
  it("P-D1: 项目删除后 project scope 无残留 vfs_entry", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-PD1-${suffix}`);
    await ctx.projectVfs(project.id).write("/tpl.md", `T-${suffix}`);

    const copy = await ctx.projects.copy(project.id);
    const copyScope = `project:${copy.id}`;
    assert.ok(
      (await entryRowCount(copyScope)) > 0,
      "前置条件：复制体 project scope 下应有 entry 行",
    );

    await ctx.projects.delete(copy.id);

    assert.equal(
      await entryRowCount(copyScope),
      0,
      "项目删除后 project scope 不应残留 vfs_entry 行",
    );
  });

  it("P-D2: 项目删除释放 project scope 的 live-head revision（ref_count=1 → 行回收）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-PD2-${suffix}`);
    await ctx.projectVfs(project.id).write("/tpl.md", `T-${suffix}`);

    const copy = await ctx.projects.copy(project.id);
    const copyScope = `project:${copy.id}`;
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const entry = await entryRepo.findByPath(copyScope, "/tpl.md");
    assert.ok(entry != null, "复制体 project scope 应有 /tpl.md");
    const version = await revisionRepo.findMaxVersionForEntry(entry.entryId);
    assert.ok(version != null, "复制体应已 seed live-head revision");
    const entryId = entry.entryId;

    // 前置条件：live-head revision 行在，ref_count = 1
    assert.equal(
      await revisionRowCount(entryId, version),
      1,
      "前置条件：live-head revision 行存在",
    );
    const refBefore = (await revisionRefCounts(entryId)).find(
      ([v]) => v === version,
    )!;
    assert.equal(refBefore[1], 1, "前置条件：live-head revision ref_count = 1");

    const hash = await entryRepo.findContentHash(copyScope, "/tpl.md");
    assert.ok(hash != null);
    const blobBefore = await blobRefCount(hash);

    await ctx.projects.delete(copy.id);

    assert.equal(
      await revisionRowCount(entryId, version),
      0,
      "项目删除后 project scope 的 live-head revision 应被回收（ref_count=1 的行全局兜底选不中，只有 scoped GC 能收）",
    );
    assert.equal(
      await entryRowCount(copyScope),
      0,
      "项目删除后 project scope 不应残留 entry 行",
    );
    // blob 口径：按内容寻址、与源项目共享，blob 行必然仍在（源项目还引用着），
    // 所以主口径只能是 ref_count 相对删除前恰好 −1。
    assert.equal(
      await blobRefCount(hash),
      blobBefore - 1,
      "content blob 的 ref_count 相对删除前应恰好 −1",
    );
  });

  it("P-D3: 项目删除释放 project:meta scope 的 live-head revision（技能域同款）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-PD3-${suffix}`);
    await ctx.projectMetaVfs(project.id).write(
      "/skills/skill.md",
      `S-${suffix}`,
    );

    const copy = await ctx.projects.copy(project.id);
    const metaScope = `project:${copy.id}:meta`;
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const entry = await entryRepo.findByPath(metaScope, "/skills/skill.md");
    assert.ok(entry != null, "复制体 meta scope 应有技能文件");
    const version = await revisionRepo.findMaxVersionForEntry(entry.entryId);
    assert.ok(version != null, "复制体 meta scope 应已 seed live-head revision");
    const entryId = entry.entryId;

    assert.equal(
      await revisionRowCount(entryId, version),
      1,
      "前置条件：meta scope 的 live-head revision 行存在",
    );

    await ctx.projects.delete(copy.id);

    assert.equal(
      await revisionRowCount(entryId, version),
      0,
      "项目删除后 project:meta scope 的 live-head revision 应被回收",
    );
    assert.equal(
      await entryRowCount(metaScope),
      0,
      "项目删除后 project:meta scope 不应残留 entry 行",
    );
  });

  it("P-D4: 项目删除不做二次 decrement（delete 不抛错 + 会话 scope revision 计数零变化）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-PD4-${suffix}`);
    await ctx.projectVfs(project.id).write("/tpl.md", `T-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    await ctx
      .sessionVfs(project.id, session.id)
      .write("/in-session.md", `S-${suffix}`);

    // 会话 scope 的一个 entry（project scope 的 sweep 绝不该波及它）
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const sessionScope = `session:${project.id}:${session.id}`;
    const sessionEntry = await entryRepo.findByPath(
      sessionScope,
      "/in-session.md",
    );
    assert.ok(sessionEntry != null, "会话 scope 应有 entry 行");
    const sessionEntryId = sessionEntry.entryId;
    const before = await revisionRefCounts(sessionEntryId);
    assert.ok(before.length > 0, "前置条件：会话 entry 至少有 revision 行");

    // ① delete 不抛错：若 `session:{pid}:{sid}` 那行被误改成 sweep，
    // 会话 scope 的 live ref 会被二次 −1，撞 vfs_revision 的
    // CHECK (ref_count >= 0) 抛 SQLITE_CONSTRAINT_CHECK ⇒ 整个事务回滚。
    await ctx.projects.delete(project.id);

    // ② 会话 scope 的 revision 必须被**彻底回收**。
    // 注意：spec 里写的「删除前后 revisionRefCounts 深比对完全相等」在项目
    // 删除语义下不可观测——delete 本身就会把会话 scope 一并删掉，行是被正确
    // 回收的，不是「零变化」。真正可观测的等价口径是「删除后该 entry 的
    // revision 行数为 0」：会话链若仍是「只删 entry、不 GC」的形态，行会以
    // ref_count=0 的孤儿形态留下；若是二次 decrement 的形态，上面 ① 先抛错。
    // 断言也不能写成「ref_count >= 0」——那是恒真断言：DDL 的 CHECK (ref_count >= 0)
    // 保证它无论实现怎么错都成立。
    assert.deepEqual(
      await revisionRefCounts(sessionEntryId),
      [],
      "会话 scope 的 revision 应被正确回收（不得残留 ref_count=0 的孤儿行，也不得被二次 decrement）",
    );
    assert.equal(
      await entryRowCount(sessionScope),
      0,
      "会话 scope 不应残留 entry 行",
    );
    assert.equal(
      await revisionRowCount(sessionEntryId, before[0]![0]),
      0,
      "会话 scope 该版本的 revision 行应已回收",
    );
  });
});