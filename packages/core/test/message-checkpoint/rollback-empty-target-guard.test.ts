import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { isSessionFsError } from "@novel-master/core/session-fs";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

// T-DS2（S-13 护栏）：undo_send 解析出的 targetTree 经过 prior + anchor
// 两轮兜底后仍为空时，reconcileVfsPaths 会把 live 树里所有路径都判定为
// 「需删除」，从而把整个会话工作区删光。这里验证护栏在该场景下抛
// ROLLBACK_UNDO_SEND_EMPTY_TARGET，且文件数不减少、消息也不被截断。
novelMasterTestFixture();

describe("MessageRollbackService S-13 empty-target guardrail (T-DS2)", () => {
  it("T-DS2a: 首条 plain user 无任何 baseline 时 undo_send 报错且文件不减少", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tds2a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 会话开始就有文件，模拟角色卡导入前用户手写的内容。
    await svfs.write("/keep-a.md", "a", { versionCheck: false });
    await svfs.write("/keep-b.md", "b", { versionCheck: false });

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });
    // assistant 又写了新文件，扩大「会被误删」的面。
    await svfs.write("/later.md", "later", { versionCheck: false });

    const filesBefore = (await svfs.list("/")).length;

    await assert.rejects(
      () => ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id),
      (error: unknown) => {
        assert.equal(
          isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
          true,
          "应抛 ROLLBACK_UNDO_SEND_EMPTY_TARGET",
        );
        assert.match((error as Error).message, /拒绝清空会话工作区/);
        return true;
      },
    );

    // 文件一个不少；消息也没被截断。
    const filesAfter = (await svfs.list("/")).length;
    assert.equal(filesAfter, filesBefore);
    assert.equal((await svfs.read("/keep-a.md")).content, "a");
    assert.equal((await svfs.read("/keep-b.md")).content, "b");
    assert.equal((await svfs.read("/later.md")).content, "later");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 2);
  });

  it("T-DS2b: skipVfsReconcile 时不触发护栏，仅截断消息", async () => {
    // skipVfsReconcile 不进入 reconcileVfsPaths，空 targetTree 不会造成删除，
    // 护栏应放行——这是「仅截断消息」的降级回滚路径（DF-U1 同语义）。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tds2b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/keep.md", "stable", { versionCheck: false });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hello" }],
    });

    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id, {
      skipVfsReconcile: true,
    });

    assert.equal((await svfs.read("/keep.md")).content, "stable");
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 0);
  });

  it("T-DS2c: anchor 自身有 baseline checkpoint 时不触发护栏", async () => {
    // anchor 处有 capture（非空 targetTree）时即便 prior 为空也走正常回滚，
    // 护栏只在「prior + anchor 都为空」时才拦。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tds2c-${testIsolationSuffix()}`);
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

    // anchor checkpoint 存在 → targetTree 非空 → 正常回滚，不抛护栏错误。
    await ctx.sessionFs.rollbackToMessage(session.id, project.id, user1.id);

    assert.equal((await svfs.read("/anchor.md")).content, "at-send");
    await assert.rejects(() => svfs.read("/later.md"));
  });
});
