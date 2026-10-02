/**
 * CS-04：`sweepRevisionsUnderScope` 三步顺序的定向测试。
 *
 * 病症：该函数原本是「decrement live ref → 删 entry → GC 无引用 revision」，
 * 而 scoped GC（`deleteUnreferencedUnderScope`）靠 `JOIN vfs_entry` 圈定范围，
 * entry 在第 2 步已被整棵删掉 ⇒ JOIN 命中 0 行 ⇒ 第 3 步恒等于删 0 行，
 * 即这条被 5 个调用点当作「释放引用 + 删条目 + 回收 revision」三件套用的函数
 * **从来没回收过任何一行 revision**。修法：换序为 decrement → GC → 删 entry
 * （与 session 侧 `revision-gc.ts` 同源）。
 *
 * - S-O1: sweep 后 live-head revision 被回收（GC 步在删 entry 之前执行）
 * - S-O2: excludePrefixes 的豁免同时覆盖 entry 与 revision 两侧
 * - S-O3: `releaseAndDeleteVfsPrefix` 转发路径与直调行为等价（两入口逐项相等）
 *
 * @module test/vfs/sweep-revisions-order
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  releaseAndDeleteVfsPrefix,
  sweepRevisionsUnderScope,
} from "@/domain/vfs/logic/vfs-tree-copy.js";
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

/** scope 下剩余的 entry 路径（用于逐条断言豁免范围）。 */
async function remainingEntryPaths(scopeKey: string): Promise<string[]> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ path: string }>(
    `SELECT path FROM vfs_entry WHERE scope_key = ? ORDER BY path`,
    [scopeKey],
  );
  return rows.map((r) => String(r.path));
}

describe("CS-04: sweepRevisionsUnderScope 的 GC 步必须在删 entry 之前", () => {
  it("S-O1: sweep 后 live-head revision 被回收（GC 步在删 entry 之前执行）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-SO1-${suffix}`);
    const scopeKey = `project:${project.id}`;
    const pvfs = ctx.projectVfs(project.id);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    await pvfs.write("/a.md", `A-${suffix}`);
    const entry = await entryRepo.findByPath(scopeKey, "/a.md");
    assert.ok(entry != null, "写完应有 entry 行");
    const version = await revisionRepo.findMaxVersionForEntry(entry.entryId);
    assert.ok(version != null, "写完应有 live-head revision");
    const entryId = entry.entryId;
    assert.equal(
      await revisionRowCount(entryId, version),
      1,
      "前置条件：live-head revision 行存在",
    );

    await sweepRevisionsUnderScope(entryRepo, revisionRepo, scopeKey, "/");

    assert.equal(
      await revisionRowCount(entryId, version),
      0,
      "sweep 后 live-head revision 行应被回收（GC 若排在删 entry 之后恒删 0 行）",
    );
    assert.equal(
      await entryRowCount(scopeKey),
      0,
      "sweep 后 scope 下不应残留 vfs_entry 行",
    );
  });

  it("S-O2: excludePrefixes 的豁免同时覆盖 entry 与 revision 两侧", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-SO2-${suffix}`);
    const scopeKey = `project:${project.id}`;
    const pvfs = ctx.projectVfs(project.id);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    await pvfs.write("/meta/skills/keep.md", `K-${suffix}`);
    await pvfs.write("/plain/drop.md", `D-${suffix}`);

    const keptEntry = await entryRepo.findByPath(
      scopeKey,
      "/meta/skills/keep.md",
    );
    const dropEntry = await entryRepo.findByPath(scopeKey, "/plain/drop.md");
    assert.ok(keptEntry != null);
    assert.ok(dropEntry != null);
    const keptVersion = await revisionRepo.findMaxVersionForEntry(
      keptEntry.entryId,
    );
    const dropVersion = await revisionRepo.findMaxVersionForEntry(
      dropEntry.entryId,
    );
    assert.ok(keptVersion != null, "豁免侧应有 live-head revision");
    assert.ok(dropVersion != null, "非豁免侧应有 live-head revision");
    // 前置条件：两侧 revision 此刻都还在（否则下面「豁免侧仍在」是恒空断言）
    assert.equal(
      await revisionRowCount(keptEntry.entryId, keptVersion),
      1,
      "前置条件：豁免侧 revision 初始存在",
    );
    assert.equal(
      await revisionRowCount(dropEntry.entryId, dropVersion),
      1,
      "前置条件：非豁免侧 revision 初始存在",
    );

    await sweepRevisionsUnderScope(entryRepo, revisionRepo, scopeKey, "/", [
      "/meta/skills",
    ]);

    // 豁免侧：entry 与 revision 都还在
    assert.notEqual(
      await entryRepo.findByPath(scopeKey, "/meta/skills/keep.md"),
      null,
      "excludePrefixes 下的 entry 应豁免",
    );
    assert.equal(
      await revisionRowCount(keptEntry.entryId, keptVersion),
      1,
      "excludePrefixes 下的 live-head revision 应豁免",
    );
    // 非豁免侧：revision 被回收、entry 被删
    assert.equal(
      await revisionRowCount(dropEntry.entryId, dropVersion),
      0,
      "excludePrefixes 之外的 revision 应被回收",
    );
    assert.equal(
      await entryRepo.findByPath(scopeKey, "/plain/drop.md"),
      null,
      "非豁免侧的文件 entry 应被删",
    );
    // 残留 entry 必须全部落在豁免子树 /meta 下（/plain 整棵都该消失）
    const leftovers = await remainingEntryPaths(scopeKey);
    assert.deepEqual(
      leftovers.filter((p) => !p.startsWith("/meta")),
      [],
      "豁免前缀之外不应残留任何 vfs_entry 行",
    );
    assert.ok(
      leftovers.includes("/meta/skills/keep.md"),
      "豁免子树下的文件 entry 应保留",
    );
  });

  it("S-O3: releaseAndDeleteVfsPrefix 转发路径与 sweepRevisionsUnderScope 直调行为等价", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    // 同一夹具建两套等价数据：一套走转发、一套直调
    const fwdProject = await ctx.projects.create(`P-SO3-fwd-${suffix}`);
    const fwdScope = `project:${fwdProject.id}`;
    const fwdVfs = ctx.projectVfs(fwdProject.id);
    await fwdVfs.write("/x.md", `X-${suffix}`);
    await fwdVfs.write("/sub/y.md", `Y-${suffix}`);
    const fwdEntryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const fwdRevRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const fwdEntry = await fwdEntryRepo.findByPath(fwdScope, "/sub/y.md");
    assert.ok(fwdEntry != null);
    const fwdVersion = await fwdRevRepo.findMaxVersionForEntry(fwdEntry.entryId);
    assert.ok(fwdVersion != null);

    const dirProject = await ctx.projects.create(`P-SO3-dir-${suffix}`);
    const dirScope = `project:${dirProject.id}`;
    const dirVfs = ctx.projectVfs(dirProject.id);
    await dirVfs.write("/x.md", `X-${suffix}`);
    await dirVfs.write("/sub/y.md", `Y-${suffix}`);
    const dirEntryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const dirRevRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const dirEntry = await dirEntryRepo.findByPath(dirScope, "/sub/y.md");
    assert.ok(dirEntry != null);
    const dirVersion = await dirRevRepo.findMaxVersionForEntry(dirEntry.entryId);
    assert.ok(dirVersion != null);

    await releaseAndDeleteVfsPrefix(fwdEntryRepo, fwdRevRepo, fwdScope, "/");
    await sweepRevisionsUnderScope(dirEntryRepo, dirRevRepo, dirScope, "/");

    // 两个入口的 entry / revision 侧计数逐项相等
    assert.equal(
      await entryRowCount(fwdScope),
      await entryRowCount(dirScope),
      "两入口的 vfs_entry 残留行数应相等",
    );
    assert.equal(
      await revisionRowCount(fwdEntry.entryId, fwdVersion),
      await revisionRowCount(dirEntry.entryId, dirVersion),
      "两入口的 live-head revision 残留行数应相等",
    );
    // 且两侧都已真正回收（否则这条等价断言恒等于「两入口一起不回收」，是恒空断言）
    assert.equal(
      await entryRowCount(fwdScope),
      0,
      "转发入口应删净 entry（否则等价断言无牙齿）",
    );
    assert.equal(
      await revisionRowCount(fwdEntry.entryId, fwdVersion),
      0,
      "转发入口应回收 live-head revision（否则等价断言无牙齿）",
    );
  });
});