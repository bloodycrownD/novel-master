import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { isSessionFsError } from "@novel-master/core/session-fs";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { createMessageRollbackService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("rollbackToMessage", () => {
  it("T-RB1: message rollback 可升 live head；同文 write 吃短路", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "here" }],
    });
    await svfs.write("/rb1.md", "anchor-body", { versionCheck: false });
    const v1 = (await svfs.read("/rb1.md")).version;
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.write("/rb1.md", "later-body", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    const after = await svfs.read("/rb1.md");
    assert.equal(after.content, "anchor-body");
    // 产品允许 live ≠ 锚点 version（可升 live head）
    assert.ok(after.version >= v1);

    // 同文再 write（带 expectedVersion）吃短路，不 bump
    const again = await svfs.write("/rb1.md", "anchor-body", {
      expectedVersion: after.version,
      versionCheck: true,
    });
    assert.equal(again.version, after.version);
    assert.equal((await svfs.read("/rb1.md")).content, "anchor-body");
  });

  it("assistant anchor keeps that round write and rolls back later checkpoints", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "here" }],
    });
    await svfs.write("/poem.md", "roses", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.write("/poem.md", "violets", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(
      session.id,
      project.id,
      assistant1.id,
    );

    assert.equal((await svfs.read("/poem.md")).content, "roses");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.id, user1.id);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("plain user undo_send 无 baseline 时护栏拒绝删光工作区", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("write poem"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });
    await svfs.write("/poem.md", "draft", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);
    await ctx.messages.append(session.id, "user", textBlocks("nice"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "thanks" }],
    });

    // S-13 护栏：user1 首条 plain user，prior 与 anchor 均无 baseline 快照，
    // targetTree 为空 → 拒绝 reconcile，保留 /poem.md 与现有消息。
    await assert.rejects(
      () => ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) =>
        isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
    );
    assert.equal((await svfs.read("/poem.md")).content, "draft");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 4);
  });

  it("plain user undo_send 无 prior 时护栏拒绝清空工作区", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/keep.md", "stable", { versionCheck: false });

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("bye"));

    // S-13 护栏：没有任何 baseline checkpoint，targetTree 为空，拒绝删除。
    await assert.rejects(
      () => ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) =>
        isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
    );
    assert.equal((await svfs.read("/keep.md")).content, "stable");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 3);
  });

  it("deleteAfterSeq removes only higher seq", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "user", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const repo = new SqliteMessageRepository(ctx.conn);
    await repo.deleteAfterSeq(session.id, m1.seq);

    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 1);
    assert.equal(left[0]!.id, m1.id);
  });

  it("rollback 默认路径首条 plain user（无文件会话）放行仅截断", async () => {
    // 与下一条 skipVfsReconcile 用例呼应：无文件会话（纯聊天 / 仅 $skill 引用，
    // capture 不写空快照）空 targetTree 无破坏力，S-13 护栏放行，回滚表现为纯截断；
    // 有文件无基线才拦（见上用例），上层走「仅截断」降级弹窗。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const rollback = createMessageRollbackService(ctx.conn);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "bye" }],
    });

    await rollback.rollbackToMessage(session.id, project.id, user1.id);
    // undo_send 语义：锚点 user 消息一并删除（还原为草稿），后续 assistant 同截
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("skipVfsReconcile 截断消息", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const rollback = createMessageRollbackService(ctx.conn);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await rollback.rollbackToMessage(session.id, project.id, user1.id, {
      skipVfsReconcile: true,
    });
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("sessionFs facade rollback：assistant rewind 截断尾部，保留锚点", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "bye" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
    assert.equal(left[0]!.id, user1.id);
    assert.equal(left[1]!.id, assistant1.id);
  });
});
