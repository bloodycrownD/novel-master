/**
 * F1 fork/copy 规则与活树快照 parity（T-F1…T-F6）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createWorkplaceService } from "@novel-master/core/workplace";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { toPhysicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("fork/copy parity (F1)", () => {
  it("T-F1: fork 后目标 revision 含 content，checkpoint 指向该 version", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/note.md", "fork-body", { versionCheck: false });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(session.id, "assistant", textBlocks("2"));

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 2);

    const physical = toPhysicalPath(
      { kind: "session", projectId: project.id, sessionId: forked.id },
      "/note.md",
    );
    const live = await ctx.sessionVfs(project.id, forked.id).read("/note.md");
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const rev = await revisions.findByPathAndVersion(physical, live.version);
    assert.ok(rev, "须存在带 content 的 vfs_revision，不得靠 backfill");
    assert.equal(rev.content, "fork-body");
    assert.equal(rev.status, "active");

    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);
    for (const msg of forkedMsgs) {
      const tree = await checkpoints.loadFileTree(forked.id, msg.id);
      assert.ok(tree, `消息 ${msg.id} 须有 checkpoint`);
      assert.equal(tree.get("/note.md"), live.version);
    }
    // 源消息 id 未参与
    assert.notEqual(forkedMsgs[0]!.id, m1.id);
  });

  it("T-F2: 源 session 自定义 inclusion/sort → fork/copy 后规则一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/a.md", "A", {
      versionCheck: false,
    });
    const swt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await swt.setFileRule({ logicalPath: "/a.md", inclusionMode: "show" });
    await swt.setDirRule({
      logicalPath: "/",
      headCount: 7,
      sortField: "updated",
      sortOrder: "desc",
    });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));

    const forked = await ctx.messages.fork(session.id, m1.id);
    const fwt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: forked.id,
    });
    const forkedDir = await fwt.getDirRule("/");
    assert.ok(forkedDir);
    assert.equal(forkedDir.headCount, 7);
    assert.equal(forkedDir.sortField, "updated");
    assert.equal(forkedDir.sortOrder, "desc");
    const forkedRows = await fwt.buildListRows();
    const forkedFile = forkedRows.find(
      (r) => r.kind === "file" && r.path === "/a.md",
    );
    assert.ok(forkedFile && forkedFile.kind === "file");
    assert.equal(forkedFile.inclusionMode, "show");

    const copy = await ctx.sessions.copy(session.id);
    const cwt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: copy.id,
    });
    const copyDir = await cwt.getDirRule("/");
    assert.ok(copyDir);
    assert.equal(copyDir.headCount, 7);
    assert.equal(copyDir.sortField, "updated");
    const copyRows = await cwt.buildListRows();
    const copyFile = copyRows.find(
      (r) => r.kind === "file" && r.path === "/a.md",
    );
    assert.ok(copyFile && copyFile.kind === "file");
    assert.equal(copyFile.inclusionMode, "show");
  });

  it("T-F3: fork 后对第二条 plain user undo_send → 文件仍在", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/keep.md", "stable", {
      versionCheck: false,
    });
    await ctx.messages.append(session.id, "user", textBlocks("first"));
    const m2 = await ctx.messages.append(session.id, "user", textBlocks("second"));

    const forked = await ctx.messages.fork(session.id, m2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 2);
    const second = forkedMsgs[1]!;

    await ctx.sessionFs.rollbackToMessage(forked.id, project.id, second.id);

    const left = await ctx.messages.listBySession(forked.id);
    assert.equal(left.length, 1);
    assert.equal(
      (await ctx.sessionVfs(project.id, forked.id).read("/keep.md")).content,
      "stable",
    );
  });

  it("T-F4: fork 后对中间 assistant rewind → 不清空", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/poem.md", "roses", {
      versionCheck: false,
    });
    await ctx.messages.append(session.id, "user", textBlocks("u1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("a1"));
    await ctx.messages.append(session.id, "user", textBlocks("u2"));
    const a2 = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("a2"),
    );

    const forked = await ctx.messages.fork(session.id, a2.id);
    const forkedMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMsgs.length, 4);
    const midAssistant = forkedMsgs[1]!;
    assert.equal(midAssistant.role, "assistant");

    await ctx.sessionFs.rollbackToMessage(
      forked.id,
      project.id,
      midAssistant.id,
    );

    const left = await ctx.messages.listBySession(forked.id);
    assert.equal(left.length, 2);
    assert.equal(
      (await ctx.sessionVfs(project.id, forked.id).read("/poem.md")).content,
      "roses",
    );
  });

  it("T-F5: 仅一条 plain user 的新会话 undo_send → 允许工作区空（已知可接受）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/gone.md", "x", {
      versionCheck: false,
    });
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("only"));

    const forked = await ctx.messages.fork(session.id, m1.id);
    const only = (await ctx.messages.listBySession(forked.id))[0]!;
    await ctx.sessionFs.rollbackToMessage(forked.id, project.id, only.id);

    assert.equal((await ctx.messages.listBySession(forked.id)).length, 0);
    await assert.rejects(() =>
      ctx.sessionVfs(project.id, forked.id).read("/gone.md"),
    );
  });

  it("T-F6: fork/copy 后不复制 session_kkv", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/n.md", "n", {
      versionCheck: false,
    });
    await ctx.sessionKkv.set(session.id, "rule_snapshot", "k1", "source-value");
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));

    const forked = await ctx.messages.fork(session.id, m1.id);
    assert.equal(
      await ctx.sessionKkv.get(forked.id, "rule_snapshot", "k1"),
      null,
    );
    assert.equal(
      await ctx.sessionKkv.get(session.id, "rule_snapshot", "k1"),
      "source-value",
    );

    const copy = await ctx.sessions.copy(session.id);
    assert.equal(
      await ctx.sessionKkv.get(copy.id, "rule_snapshot", "k1"),
      null,
    );
    assert.equal(
      await ctx.sessionKkv.get(session.id, "rule_snapshot", "k1"),
      "source-value",
    );
  });
});
