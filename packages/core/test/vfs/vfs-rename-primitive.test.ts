/**
 * VFS rename 原语测试（Step 8）。
 *
 * T-V1: 70 文件目录 rename < 100ms（V1 硬指标）
 * T-V2: rename 后新旧 path 不共存于 vfs_entry
 * T-V3: rename 后历史 revision 仍可达（entry_id 不变）
 *
 * @module test/vfs/vfs-rename-primitive
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type VfsService } from "@novel-master/core/vfs";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

async function seed70Files(vfs: VfsService, prefix: string): Promise<void> {
  await vfs.mkdir(prefix);
  for (let i = 0; i < 70; i++) {
    await vfs.write(`${prefix}/file-${i}.md`, `content-${i}`, {
      versionCheck: false,
    });
  }
}

describe("vfs rename primitive", () => {
  it("T-V1: 70 文件目录 rename < 100ms", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-V1-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const oldDir = "/原著2";
    const newDir = "/原著";
    await seed70Files(svfs, oldDir);

    const start = performance.now();
    await svfs.renamePrefix(oldDir, newDir);
    const elapsed = performance.now() - start;

    assert.ok(
      elapsed < 100,
      `70 文件目录 rename 耗时 ${elapsed.toFixed(1)}ms，超 100ms 阈值`,
    );
  });

  it("T-V2: rename 后新旧 path 不共存", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-V2-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);

    // 通过 VfsService 获取 scopeKey（session scope）
    const scopeKey = `session:${project.id}:${session.id}`;

    const oldDir = "/旧目录";
    const newDir = "/新目录";
    await seed70Files(svfs, oldDir);

    // rename 前旧路径可查
    const before = await entryRepo.findByPath(scopeKey, `${oldDir}/file-0.md`);
    assert.notEqual(before, null, "rename 前旧路径应存在");

    await svfs.renamePrefix(oldDir, newDir);

    // rename 后旧路径不可查
    const afterOld = await entryRepo.findByPath(scopeKey, `${oldDir}/file-0.md`);
    assert.equal(afterOld, null, "rename 后旧路径不应存在");

    // rename 后新路径可查
    const afterNew = await entryRepo.findByPath(scopeKey, `${newDir}/file-0.md`);
    assert.notEqual(afterNew, null, "rename 后新路径应存在");
    assert.equal(afterNew!.entryKind, "file", "rename 后新路径应为文件");
  });

  it("T-V3: rename 后历史 revision 仍可达", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-V3-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    const scopeKey = `session:${project.id}:${session.id}`;
    const oldPath = "/历史测试文件.md";
    const newPath = "/改名后文件.md";

    // 写若干版本
    await svfs.write(oldPath, "v1", { versionCheck: false });
    await svfs.write(oldPath, "v2", { versionCheck: false });
    await svfs.write(oldPath, "v3", { versionCheck: false });

    // 记录 rename 前的 entry_id
    const entryBefore = await entryRepo.findByPath(scopeKey, oldPath);
    assert.notEqual(entryBefore, null);
    const entryId = entryBefore!.entryId;

    // rename
    await svfs.renamePath(oldPath, newPath);

    // rename 后 entry_id 不变
    const entryAfter = await entryRepo.findByPath(scopeKey, newPath);
    assert.notEqual(entryAfter, null);
    assert.equal(entryAfter!.entryId, entryId, "rename 后 entry_id 应不变");

    // 历史 revision 仍可达
    for (const ver of [1, 2, 3]) {
      const rev = await revisionRepo.findByEntryAndVersion(entryId, ver);
      assert.notEqual(rev, null, `revision v${ver} 在 rename 后应可达`);
      assert.equal(rev!.status, "active", `revision v${ver} 应为 active`);
    }

    // 按旧 path 查 revision 不可达（entry 已不存在于旧 path）
    const oldEntry = await entryRepo.findByPath(scopeKey, oldPath);
    assert.equal(oldEntry, null, "rename 后旧路径对应 entry 应不存在");
  });
});
