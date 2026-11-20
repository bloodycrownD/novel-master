import {  outcomeValue  } from "../helpers/outcome-value.js";
import {  unwrap, rejectsErr  } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  TextBlocks  } from "@novel-master/core/chat";
import {  isSessionFsError  } from "../../src/errors/guards.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";

// T-DS4（S-13 扩展）：Step 9 在 run-agent-turn 源头给每条新 user 消息写
// baseline checkpoint，但 Step 9 之前产生的旧消息可能没有任何 checkpoint。
// backfillMissingBaselines 是会话级迁移入口——把「最后一个有 checkpoint 的
// 消息之后」所有空窗消息都补上 baseline。这里直接覆盖 service 方法本身，
// runAgentTurn 集成由 run-agent-turn.test.ts 的 T-DS5 守护。
novelMasterTestFixture();

describe("MessageCheckpointService.backfillMissingBaselines (T-DS4)", () => {
  it("T-DS4a: 历史消息全部缺 baseline 时从头补齐，让 undo_send 能回滚", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(
      `P-tds4a-${testIsolationSuffix()}`,
    ));
    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 模拟 Step 9 之前的旧会话：写文件 + 写消息，但全程不 capture。
    await svfs.write("/anchor.md", "at-send", { versionCheck: false });
    const user1 = (
      unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("anchor")))
    ).id;
    unwrap(await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "hi" }],
    }));

    // backfill 前直接 undo_send 会被 Step 8 的护栏拦下（空 targetTree）。
    await rejectsErr(
      () => ctx.sessionFs.rollbackFilesToMessage(session.id, project.id, user1),
      (error: unknown) =>
        isSessionFsError(error, "ROLLBACK_UNDO_SEND_EMPTY_TARGET"),
    );

    // 跑一次 backfill，把所有空窗消息补上 baseline。
    unwrap(await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id));

    // 之后又改了文件——backfill 时记下来的就是 at-send 版本。
    await svfs.write("/anchor.md", "after-backfill", { versionCheck: false });
    await svfs.write("/later.md", "new", { versionCheck: false });

    // 现在 undo_send 不再触发护栏，且回滚到 backfill 时的快照（user1 是
    // undo_send 锚点，回滚后 user1 自身也被删除——和 R2 同语义）。
    await ctx.sessionFs.rollbackFilesToMessage(session.id, project.id, user1);

    assert.equal(unwrap(await svfs.read("/anchor.md")).content, "at-send");
    assert.ok(!(await svfs.read("/later.md")).ok, "later.md 应已被回滚删除");
    const messages = outcomeValue(await ctx.messages.listBySession(session.id));
    assert.equal(messages.length, 0);
  });

  it("T-DS4b: 已有 checkpoint 的消息不被覆盖，仅补其后的空窗", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(
      `P-tds4b-${testIsolationSuffix()}`,
    ));
    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 前半段：正常 capture，建立 baseline 快照 v1。
    await svfs.write("/keep.md", "v1", { versionCheck: false });
    unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("first")));
    const assistant1 = (
      unwrap(await ctx.messages.append(session.id, "assistant", {
        blocks: [{ type: "text", text: "ok" }],
      }))
    ).id;
    unwrap(await ctx.messageCheckpoint.capture(session.id, project.id, assistant1));

    // 后半段：模拟 Step 9 之前的旧路径——追加消息但不 capture。
    await svfs.write("/keep.md", "v2", { versionCheck: false });
    await svfs.write("/tail.md", "tail-v", { versionCheck: false });

    // backfill：assistant1 已有 checkpoint，不会被动；空窗（assistant1 之后
    // 没有新消息，所以这里其实没有空窗可补）。这次调用主要验证 backfill
    // 不会反过来把 assistant1 的 v1 覆盖成 v2。
    unwrap(await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id));

    // 改文件后回滚到 assistant1：必须拿到 v1，证明 backfill 没覆盖。
    await svfs.write("/keep.md", "dirty", { versionCheck: false });
    await svfs.write("/tail.md", "tail-dirty", { versionCheck: false });
    await ctx.sessionFs.rollbackFilesToMessage(session.id, project.id, assistant1);

    assert.equal(unwrap(await svfs.read("/keep.md")).content, "v1");
    // tail.md 不在 assistant1 的 checkpoint 里——回滚会删除它。
    assert.ok(!(await svfs.read("/tail.md")).ok, "tail.md 应已被回滚删除");
    const messages = outcomeValue(await ctx.messages.listBySession(session.id));
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.id, assistant1);
  });

  it("T-DS4c: 幂等——无空窗时是 no-op，连续调用结果一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(
      `P-tds4c-${testIsolationSuffix()}`,
    ));
    const session = unwrap(await ctx.sessions.create(project.id));
    const svfs = ctx.sessionVfs(project.id, session.id);

    await svfs.write("/a.md", "a", { versionCheck: false });
    const user1 = (
      unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("hi")))
    ).id;
    unwrap(await ctx.messageCheckpoint.capture(session.id, project.id, user1));

    // 没有空窗：第一次 backfill 应直接 short-circuit。
    unwrap(await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id));
    // 再跑一次验证幂等。
    unwrap(await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id));

    await svfs.write("/a.md", "dirty", { versionCheck: false });
    await ctx.sessionFs.rollbackFilesToMessage(session.id, project.id, user1);
    assert.equal(unwrap(await svfs.read("/a.md")).content, "a");
  });

  it("T-DS4d: 无 live 文件时是 no-op，不抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(
      `P-tds4d-${testIsolationSuffix()}`,
    ));
    const session = unwrap(await ctx.sessions.create(project.id));

    unwrap(await ctx.messages.append(session.id, "user", TextBlocks.of("hi")));

    // 会话里没有任何文件，backfill 应直接返回，不写入 checkpoint。
    unwrap(await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id));

    const messages = outcomeValue(await ctx.messages.listBySession(session.id));
    assert.equal(messages.length, 1);
  });
});
