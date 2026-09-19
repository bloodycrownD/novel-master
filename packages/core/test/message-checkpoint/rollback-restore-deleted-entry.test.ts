/**
 * rollback-restore-deleted-entry 行为测试。
 *
 * 覆盖：
 *  1. 删除 → 同路径新建（新 entry 新内容）→ 回滚：旧内容回来、tail 期新建的
 *     同路径文件被回退（新 entry 被墓碑）——语义按「回滚后工作区正文 =
 *     目标检查点完成态」拍板；
 *  2. 复活走显式 entry_id 插入：sqlite_sequence 不回退，复活后再新建文件
 *     entry_id 不与被复活 entry 撞号；
 *  3. 目录下多文件删除 → 回滚：全部复现（父目录链重建）；
 *  4. diverged（删除后同路径重建）且锚点版本高于重建 entry（V=2 > 重建
 *     head v1）：missing 探测按 checkpoint 旧 entryId 同源寻址，不误报
 *     BACKFILL_REQUIRED、不漏检真缺失（rsrr/B-1、rsrr/G-1）；
 *  5. diverged + 确认重试（revisionHeadBackfill）：backfill 回补打在
 *     checkpoint 旧 entryId 上，不给 live 新 entry 伪造 revision 行（rsrr/B-2）；
 *  6. 纯删除 + revision 真缺：不带选项回滚默认抛 BACKFILL_REQUIRED 走
 *     双端 UI 确认流（既有 UX 设计的 no-option 行为锚定）。
 *
 * @module test/message-checkpoint/rollback-restore-deleted-entry.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { isRollbackRevisionBackfillRequiredError } from "@novel-master/core/session-fs";
import { isVfsError } from "@novel-master/core/vfs";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("rollback-restore-deleted-entry", () => {
  it("删除后同路径重建：回滚旧内容回来、tail 期新文件被回退、entry_id 不撞号", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    // anchor：/dup.md = "old-content"（entryA）
    await svfs.write("/dup.md", "old-content", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const { scopeKey } = await import(
      "../../src/domain/vfs/logic/vfs-path-mapper.js"
    );
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entryA = await entries.findByPath(sk, "/dup.md");
    assert.ok(entryA != null);

    // tail：删除 → 同路径重建（entryB 新内容）
    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.delete("/dup.md");
    await svfs.write("/dup.md", "new-content", { versionCheck: false });
    const entryB = await entries.findByPath(sk, "/dup.md");
    assert.ok(entryB != null);
    assert.notEqual(entryB.entryId, entryA.entryId, "重建应为新 entry");

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    // 旧内容回来：按目标检查点完成态，anchor 时点 /dup.md = old-content。
    assert.equal((await svfs.read("/dup.md")).content, "old-content");
    // 复活后 live entry 就是 anchor 时的 entryA（entryId 原位复活）。
    const revived = await entries.findByPath(sk, "/dup.md");
    assert.ok(revived != null);
    assert.equal(revived.entryId, entryA.entryId);
    assert.equal(revived.headVersion, entryA.headVersion);

    // tail 期新建的 entryB 已被墓碑删除，其 revision 历史保留在自己的 entryId 下。
    const tombstones = await ctx.conn.query<{ status: string }>(
      "SELECT status FROM vfs_revision WHERE entry_id = ? ORDER BY version",
      [entryB.entryId],
    );
    assert.ok(
      tombstones.some((r) => r.status === "deleted"),
      "entryB 应有墓碑 revision",
    );

    // sqlite_sequence 不回退：复活（显式插 entryA.entryId）后再新建文件，
    // 新 entry_id 必须越过已有最大值，不得与被复活 entry 撞号。
    const seqBefore = await ctx.conn.query<{ seq: number | null }>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'vfs_entry'",
    );
    const maxId = Math.max(entryA.entryId, entryB.entryId);
    assert.ok(
      Number(seqBefore[0]?.seq ?? 0) >= maxId,
      "显式插入后 sqlite_sequence 不应低于历史最大 entry_id",
    );
    await svfs.write("/fresh.md", "fresh", { versionCheck: false });
    const freshEntry = await entries.findByPath(sk, "/fresh.md");
    assert.ok(freshEntry != null);
    assert.ok(
      freshEntry.entryId > maxId,
      "复活后新建文件的 entry_id 应越过历史最大值",
    );
    assert.notEqual(freshEntry.entryId, entryA.entryId);
    assert.notEqual(freshEntry.entryId, entryB.entryId);
  });

  it("目录下多文件删除：回滚后全部复现", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/docs/a.md", "alpha", { versionCheck: false });
    await svfs.write("/docs/b.md", "beta", { versionCheck: false });
    await svfs.write("/docs/sub/c.md", "gamma", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    // 递归删除整棵 /docs 子树（每个文件的 entry 行都被物理删除）。
    await svfs.delete("/docs", { recursive: true });
    await assert.rejects(
      () => svfs.read("/docs/a.md"),
      (error: unknown) => isVfsError(error, "NOT_FOUND"),
    );

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/docs/a.md")).content, "alpha");
    assert.equal((await svfs.read("/docs/b.md")).content, "beta");
    assert.equal((await svfs.read("/docs/sub/c.md")).content, "gamma");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("rename 后回滚：历史 checkpoint 路径冻结 capture 时点（快照语义）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde3-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    // anchor 时点文件在 /origin.md。
    await svfs.write("/origin.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    // tail 期 rename 到 /renamed.md（entry 不变、path 变更）。
    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await svfs.renamePath("/origin.md", "/renamed.md");

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    // path 快照冻结 capture 时点路径：回滚后文件回到 /origin.md（anchor 完成态），
    // tail 期的现路径 /renamed.md 被清除——与旧行为（跟随现路径 /renamed.md）不同，
    // 属本修复引入的有意行为变更。
    assert.equal((await svfs.read("/origin.md")).content, "v1");
    await assert.rejects(
      () => svfs.read("/renamed.md"),
      (error: unknown) => isVfsError(error, "NOT_FOUND"),
    );
  });

  it("锚点版本高于重建 entry（V=2）：无选项回滚直接复现旧内容，不误报 BACKFILL_REQUIRED", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde4-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    // anchor：/dup2.md 写两次 → head v2（entryA 持有 v1/v2 两个 revision）。
    await svfs.write("/dup2.md", "old-v1", { versionCheck: false });
    await svfs.write("/dup2.md", "old-v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const { scopeKey } = await import(
      "../../src/domain/vfs/logic/vfs-path-mapper.js"
    );
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entryA = await entries.findByPath(sk, "/dup2.md");
    assert.ok(entryA != null);

    // tail：删除 → 同路径重建一次（entryB 只有 v1，checkpoint 指针仍指
    // (entryA, 2)——按 live entryB 寻址 (entryB, 2) 必查不到）。
    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.delete("/dup2.md");
    await svfs.write("/dup2.md", "new-content", { versionCheck: false });
    const entryB = await entries.findByPath(sk, "/dup2.md");
    assert.ok(entryB != null);
    assert.notEqual(entryB.entryId, entryA.entryId);

    // 不带 revisionHeadBackfill：missing 探测按 checkpoint 旧 entryA 寻址，
    // (entryA, 2) 在 → 不算 missing、不抛 BACKFILL_REQUIRED，restore 直接
    // 墓碑 entryB 并复活 entryA。
    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/dup2.md")).content, "old-v2");
    const revived = await entries.findByPath(sk, "/dup2.md");
    assert.ok(revived != null);
    assert.equal(revived.entryId, entryA.entryId);
  });

  it("diverged + 旧 entry revision 真缺：无选项回滚抛 BACKFILL_REQUIRED 而非 VFS_RESTORE_FAILED", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde5-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    // anchor 写两次：checkpoint 指针为 (entryA, 2)。
    await svfs.write("/dup2.md", "old-v1", { versionCheck: false });
    await svfs.write("/dup2.md", "old-v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const { scopeKey } = await import(
      "../../src/domain/vfs/logic/vfs-path-mapper.js"
    );
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entryA = await entries.findByPath(sk, "/dup2.md");
    assert.ok(entryA != null);

    // tail：删除 → 同路径重建也写两次（entryB 到 v2）——(entryB, 2) 恰好
    // 存在，missing 探测若误按 live entryB 寻址会漏检，直接进 restore 后
    // 复活读不到 (entryA, 2) 被包成 VFS_RESTORE_FAILED，绕过 backfill 确认流。
    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.delete("/dup2.md");
    await svfs.write("/dup2.md", "new-v1", { versionCheck: false });
    await svfs.write("/dup2.md", "new-v2", { versionCheck: false });

    // 手工删 (entryA, 2)：旧 entry 的 anchor revision 真缺。
    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE entry_id = ? AND version = ?",
      [entryA.entryId, 2],
    );

    // 默认不带选项：应走 BACKFILL_REQUIRED 确认流（双端 UI 确认后带
    // revisionHeadBackfill 重试降级），而非整体 VFS_RESTORE_FAILED。
    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
      (error: unknown) => isRollbackRevisionBackfillRequiredError(error),
    );
  });

  it("diverged + 确认重试：backfill 回补打在旧 entryId，不给 live 新 entry 伪造 revision 行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde6-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    // anchor 写两次：checkpoint 指针为 (entryA, 2)。
    await svfs.write("/dup2.md", "old-v1", { versionCheck: false });
    await svfs.write("/dup2.md", "old-v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const { scopeKey } = await import(
      "../../src/domain/vfs/logic/vfs-path-mapper.js"
    );
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entryA = await entries.findByPath(sk, "/dup2.md");
    assert.ok(entryA != null);

    // tail：删除 → 同路径重建一次（entryB 只有 v1）→ 手工删 (entryA, 2)。
    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.delete("/dup2.md");
    await svfs.write("/dup2.md", "rebuilt-content", { versionCheck: false });
    const entryB = await entries.findByPath(sk, "/dup2.md");
    assert.ok(entryB != null);

    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE entry_id = ? AND version = ?",
      [entryA.entryId, 2],
    );

    // 先走默认确认流：抛 BACKFILL_REQUIRED。
    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
      (error: unknown) => isRollbackRevisionBackfillRequiredError(error),
    );

    // 双端 UI 确认后带 revisionHeadBackfill 重试：回补必须打在旧 entryA 上
    //（restore 用占位行按 live hash 降级复活）；修复前回补打在 entryB 上，
    // entryA 仍无行，restore 抛 restore-missing 被包成 VFS_RESTORE_FAILED。
    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id, {
      revisionHeadBackfill: true,
    });

    // 降级语义：锚点内容真缺，回滚后正文保持 live（重建）现状。
    assert.equal((await svfs.read("/dup2.md")).content, "rebuilt-content");
    const revived = await entries.findByPath(sk, "/dup2.md");
    assert.ok(revived != null);
    assert.equal(revived.entryId, entryA.entryId);

    // 回补行落在旧 entryA（version=2 占位存在）。
    const rowsA = await ctx.conn.query<{ status: string }>(
      "SELECT status FROM vfs_revision WHERE entry_id = ? AND version = ?",
      [entryA.entryId, 2],
    );
    assert.equal(rowsA.length, 1);

    // entryB 的 version=2 只能是复活时清除占用的墓碑，不得有伪造 active 占位行。
    const rowsB = await ctx.conn.query<{ status: string }>(
      "SELECT status FROM vfs_revision WHERE entry_id = ? AND version = ?",
      [entryB.entryId, 2],
    );
    assert.ok(
      rowsB.every((r) => r.status === "deleted"),
      "entryB v2 只能是墓碑，不得伪造 active 占位行",
    );
  });

  it("纯删除 + revision 真缺：不带选项回滚默认抛 BACKFILL_REQUIRED（既有确认流）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rde7-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/gone3.md", "anchor-gone", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const { scopeKey } = await import(
      "../../src/domain/vfs/logic/vfs-path-mapper.js"
    );
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const entry = await entries.findByPath(sk, "/gone3.md");
    assert.ok(entry != null);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    // 常规删除（entry 行物理删除）+ 手工删 anchor revision 行：entry 与
    // revision 都真缺。
    await svfs.delete("/gone3.md");
    await ctx.conn.execute(
      "DELETE FROM vfs_revision WHERE entry_id = ? AND version = ?",
      [entry.entryId, 1],
    );

    // 既有 UX 设计：默认不带选项必须抛 BACKFILL_REQUIRED 阻断，由双端
    // UI 确认后带 revisionHeadBackfill:true 重试才降级完成回滚。
    await assert.rejects(
      () =>
        ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id),
      (error: unknown) => isRollbackRevisionBackfillRequiredError(error),
    );
  });
});
