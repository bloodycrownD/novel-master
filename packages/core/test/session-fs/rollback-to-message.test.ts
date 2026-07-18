import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { createMessageRollbackService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("rollbackToMessage", () => {
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

  it("plain user undo_send 删除锚点并移除后续 assistant 写入", async () => {
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

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    await assert.rejects(() => svfs.read("/poem.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("plain user undo_send 无 prior 时纯文本 tail 删锚点并清空工作区", async () => {
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

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    await assert.rejects(() => svfs.read("/keep.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
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

  it("rollback 成功截断消息", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const rollback = createMessageRollbackService(ctx.conn);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "bye" }],
    });

    await rollback.rollbackToMessage(session.id, project.id, user1.id);
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
