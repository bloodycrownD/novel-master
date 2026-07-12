import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("MessageRollbackService (revision model)", () => {
  it("R1: rollback to assistant anchor restores earlier file content", async () => {
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

  it("R2: plain user undo_send 删除锚点并对齐发送前空树", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/anchor.md", "at-send", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("anchor"));
    await ctx.messageCheckpoint.capture(session.id, project.id, user1.id);

    await svfs.write("/anchor.md", "after-send", { versionCheck: false });
    await svfs.write("/later.md", "new file", { versionCheck: false });
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    await assert.rejects(() => svfs.read("/anchor.md"));
    await assert.rejects(() => svfs.read("/later.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("R2b: plain user undo_send 无 prior 时删光消息并移除后续文件", async () => {
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

  it("R3: plain user undo_send 无 prior 时纯文本 tail 删锚点并清空工作区", async () => {
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

  it("U1: undo_send 回滚 user₁ 保留 prior 消息并对齐发送前 checkpoint", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/state.md", "baseline", { versionCheck: false });
    const priorAsst = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "setup" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, priorAsst.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("prompt"));
    const asst1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "reply" }],
    });
    await svfs.write("/state.md", "after-user1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, asst1.id);
    await ctx.messages.append(session.id, "user", textBlocks("follow-up"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    assert.equal((await svfs.read("/state.md")).content, "baseline");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, priorAsst.id);
  });

  it("U2: undo_send 首条 plain user 删光消息且 VFS 空树", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/solo.md", "only", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("first"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hi" }],
    });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    await assert.rejects(() => svfs.read("/solo.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("U3: undo_send 含锚点 checkpoint 时仍仅用 prior tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const priorAsst = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "prior" }],
    });
    await svfs.write("/file.md", "prior-content", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, priorAsst.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("send"));
    await svfs.write("/file.md", "at-user-checkpoint", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, user1.id);
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.write("/file.md", "after", { versionCheck: false });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    assert.equal((await svfs.read("/file.md")).content, "prior-content");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, priorAsst.id);
  });

  it("N1: rewind user_vfs_action 锚点保留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const vfsUser = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("<user_vfs_action>write /a.md</user_vfs_action>"),
      {
        raw: {
          metadata: { kind: "user_vfs_action", source: "user", synthetic: true },
        },
      },
    );
    await svfs.write("/a.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, vfsUser.id);
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "done" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, vfsUser.id);

    assert.equal((await svfs.read("/a.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, vfsUser.id);
  });

  it("N2: rewind 纯 tool_result user 锚点保留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const toolUser = await ctx.messages.append(session.id, "user", {
      blocks: [{ type: "tool_result", toolUseId: "tu1", content: "ok" }],
    });
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, toolUser.id);

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, toolUser.id);
  });

  it("R4: restore creates parent directories for nested paths", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "nested" }],
    });
    await svfs.write("/deep/nested/file.md", "content", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await svfs.delete("/deep/nested/file.md", { recursive: true });
    await svfs.delete("/deep", { recursive: true });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    assert.equal((await svfs.read("/deep/nested/file.md")).content, "content");
  });

  it("R10: rollback nested file when parent directory still exists", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("go"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "nested" }],
    });
    await svfs.write("/dir/file.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "update" }],
    });
    await svfs.write("/dir/file.md", "v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    assert.equal((await svfs.read("/dir/file.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, assistant1.id);
  });

  it("R9: anchor without checkpoint uses prior checkpoint tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "mutate" }],
    });
    await svfs.write("/state.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);

    const textOnly = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "no tools" }],
    });
    await svfs.write("/state.md", "v2", { versionCheck: false });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, textOnly.id);

    assert.equal((await svfs.read("/state.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, textOnly.id);
  });

  it("truncates tail on assistant anchor when session has no checkpoints", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "legacy" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant.id);

    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, assistant.id);
  });

  it("assistant anchor before first checkpoint uses empty tree when session has later checkpoints", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("more"));

    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "write" }],
    });
    await svfs.write("/created.md", "new file", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    await assert.rejects(() => svfs.read("/created.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.id, assistant1.id);
  });

  it("tool turn: rollback on assistant anchor keeps assistant and tool_result", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await ctx.messages.append(session.id, "user", textBlocks("read file"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [
        { type: "text", text: "reading" },
        { type: "tool_use", id: "tu1", name: "read", input: { path: "/a.md" } },
      ],
    });
    await svfs.write("/a.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);
    await ctx.messages.append(session.id, "user", {
      blocks: [{ type: "tool_result", toolUseId: "tu1", content: "ok" }],
    });

    await ctx.messages.append(session.id, "user", textBlocks("more"));
    const assistant2 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "later" }],
    });
    await svfs.write("/a.md", "v2", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant2.id);

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, assistant1.id);

    assert.equal((await svfs.read("/a.md")).content, "v1");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 3);
    assert.equal(messages[0]!.role, "user");
    assert.equal(messages[1]!.id, assistant1.id);
    assert.equal(messages[2]!.role, "user");
    assert.equal(
      messages[2]!.content.blocks?.some((b) => b.type === "tool_result"),
      true,
    );
  });
});
