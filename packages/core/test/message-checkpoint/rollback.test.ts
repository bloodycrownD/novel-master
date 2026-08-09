import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createCharacterCardImportService } from "@novel-master/core/vfs";
import { isSessionFsError } from "@novel-master/core/session-fs";
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

  it("R2: plain user undo_send 无 prior 时回退到 anchor checkpoint", async () => {
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

    // 无 prior 时回退到 anchor 自身 checkpoint：/anchor.md 恢复到 capture 版本，
    // /later.md 不在 checkpoint 里 → 删除。
    assert.equal((await svfs.read("/anchor.md")).content, "at-send");
    await assert.rejects(() => svfs.read("/later.md"));
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("R2b: plain user undo_send 无 prior 时护栏拒绝删光工作区", async () => {
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

    // S-13 护栏：user1 是首条 plain user，prior 与 anchor 都没有 baseline 快照，
    // targetTree 为空——直接 reconcile 会把 /poem.md 当「需删除」清掉。这里应抛
    // ROLLBACK_UNDO_SEND_EMPTY_TARGET，且不截断消息、不动文件。
    await assert.rejects(
      () => ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) => {
        assert.equal(
          isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
          true,
        );
        return true;
      },
    );
    assert.equal((await svfs.read("/poem.md")).content, "draft");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 4);
  });

  it("R3: plain user undo_send 无 prior 时护栏拒绝清空工作区", async () => {
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

    // S-13 护栏：没有任何 baseline checkpoint，targetTree 为空，拒绝 reconcile。
    await assert.rejects(
      () => ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) =>
        isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
    );
    assert.equal((await svfs.read("/keep.md")).content, "stable");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 3);
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

  it("U2: plain user undo_send 首条无 baseline 时护栏拒删", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/solo.md", "only", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("first"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hi" }],
    });

    // S-13 护栏：首条 plain user、无 baseline，targetTree 为空 → 拒绝删除。
    await assert.rejects(
      () => ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) =>
        isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
    );
    assert.equal((await svfs.read("/solo.md")).content, "only");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
  });

  it("R-BC1: 角色卡导入 backfill baseline 后 undo_send 回首条 user 保留文件", async () => {
    // 导入角色卡会 backfill baseline checkpoint，让回滚有正确基线。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rbc1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    // 先发一条消息（纯文本，无 capture），再导入角色卡——导入 backfill
    // 会给这条消息补 baseline checkpoint。
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("你好"));

    const cardSvc = createCharacterCardImportService(ctx.conn);
    const tree = new Map<string, string>([
      ["角色描述.md", "card-desc"],
      ["世界书/设定.md", "world"],
    ]);
    await cardSvc.import(scope, tree, { confirmed: true, directoryPath: "/" });

    // 聊一轮：assistant 文本（不触发 capture，因为没改文件）。
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "你好呀" }],
    });

    // 回滚到首条 user（undo_send）。
    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    // 导入的文件应保留（baseline checkpoint 保护了它们）。
    assert.equal((await svfs.read("/角色描述.md")).content, "card-desc");
    assert.equal((await svfs.read("/世界书/设定.md")).content, "world");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("R-BC2: 消息 3 有 checkpoint，消息 6 导入时只补 4-6 不碰 1-2", async () => {
    // backfill 只应补「最后一个有 checkpoint 的消息之后」的空窗，
    // 不能给已有 checkpoint 之前的消息补（那会破坏它们原有的回滚语义）。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-rbc2-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    // 消息 1-2：纯文本，无 checkpoint。
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("first"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hi" }],
    });

    // 消息 3：assistant 写文件 + capture（成为最后一个有 checkpoint 的）。
    await svfs.write("/old.md", "v1", { versionCheck: false });
    const assistant3 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "wrote" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant3.id);

    // 消息 4-5：纯文本，无 checkpoint（空窗开始）。
    const user4 = await ctx.messages.append(session.id, "user", textBlocks("chat"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "reply" }],
    });

    // 消息 6 时导入角色卡——backfill 应只补 4、5、6，不碰 1、2。
    const cardSvc = createCharacterCardImportService(ctx.conn);
    const tree = new Map<string, string>([
      ["新文件.md", "imported"],
    ]);
    await cardSvc.import(scope, tree, { confirmed: true, directoryPath: "/" });

    // 验证：消息 1 没有 baseline checkpoint（backfill 没碰它），
    // 所以回滚到消息 1 时仍然走空基线（无 prior、无 anchor checkpoint）。
    // 回滚到消息 4 时，anchor 有 backfill 的 checkpoint → 文件保留。

    // 先回滚到消息 4：新文件.md 应保留（anchor checkpoint 保护）。
    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user4.id);
    assert.equal((await svfs.read("/新文件.md")).content, "imported");
    const msgsAfter4 = await ctx.messages.listBySession(session.id);
    assert.equal(msgsAfter4.length, 3); // user1, asst2, asst3
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

    // entry_id 化后 hardDelete 会删除 vfs_entry 行，revision 仍保留但无 entry 可挂载。
    // 如果 entry 被彻底删除，rollback 无法重建。测试改为只删除内容不删 entry。
    await svfs.write("/deep/nested/file.md", "overwrite", { versionCheck: false });

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
