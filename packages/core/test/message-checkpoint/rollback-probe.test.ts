/**
 * T-R0（rollback-large-jank Step 1）：回滚链分段打点存在性断言。
 *
 * core 侧探针（RollbackProbe）经 createMessageRollbackService options 注入——
 * 这里以收集数组为探针跑一次 rewind 回滚，断言 plan 拉取（行数/字节量）与
 * 事务各子步的打点都可被探针捕获；未注入时行为零变化（既有用例回归兜底）。
 * mobile 侧 [nm-rollback] 轴的 __DEV__ 门控断言在 apps/mobile 的
 * rollback-probe-timing.test.ts。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  createMessageRollbackService,
  type MessageRollbackServiceOptions,
} from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import type { RollbackProbe } from "../../src/service/message-checkpoint/message-rollback.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 收集 (label, detail) 的探针，返回标签数组视图。 */
function collectProbe(): {
  options: MessageRollbackServiceOptions;
  labels: () => string[];
  details: () => Array<Record<string, number | string> | undefined>;
} {
  const labelList: string[] = [];
  const detailList: Array<Record<string, number | string> | undefined> = [];
  const probe: RollbackProbe = (label, detail) => {
    labelList.push(label);
    detailList.push(detail);
  };
  return {
    options: { probe },
    labels: () => labelList.slice(),
    details: () => detailList.slice(),
  };
}

describe("rollback chain probe (T-R0)", () => {
  it("T-R0: rewind 回滚全链探针可捕获 plan 拉取与事务各子步打点", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-tr0-${testIsolationSuffix()}`,
    );
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("hi"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "bye" }],
    });
    await svfs.write("/tr0.md", "v1", { versionCheck: false });
    await ctx.messageCheckpoint.capture(session.id, project.id, assistant1.id);
    await ctx.messages.append(session.id, "user", textBlocks("tail"));

    const collector = collectProbe();
    const rollback = createMessageRollbackService(ctx.conn, collector.options);
    await rollback.rollbackToMessage(session.id, project.id, assistant1.id);

    const labels = collector.labels();
    // 链路骨架：入口 → plan 拉取 → 事务子步 → 提交 → 完成。
    for (const expected of [
      "rollback.begin",
      "rollback.plan.messages",
      "rollback.tx.begin",
      "rollback.tx.count-check",
      "rollback.tx.reconcile-done",
      "rollback.tx.truncate-done",
      "rollback.tx.commit",
      "rollback.done",
    ]) {
      assert.ok(
        labels.includes(expected),
        `探针应捕获 ${expected}，实际收到：${labels.join(", ")}`,
      );
    }

    // plan 拉取打点携带行数与源 content 字节量（spec Step 1 度量口径）。
    const planDetail = collector.details()[labels.indexOf("rollback.plan.messages")];
    assert.equal(planDetail?.rows, 3);
    assert.equal(
      typeof planDetail?.contentBytes,
      "number",
    );
    assert.ok((planDetail?.contentBytes as number) > 0);

    // 回滚语义不受探针影响（rewind 保留锚点，tail 截断）。
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
  });

  it("未注入探针（默认）时回滚行为零变化", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-tr0b-${testIsolationSuffix()}`,
    );
    const session = await ctx.sessions.create(project.id);

    const user1 = await ctx.messages.append(session.id, "user", textBlocks("a"));
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "b" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("c"));

    // 不传 options（desktop/cli 形态）——不应抛错、行为与既有一致。
    const rollback = createMessageRollbackService(ctx.conn);
    await rollback.rollbackToMessage(session.id, project.id, assistant1.id, {
      skipVfsReconcile: true,
    });
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
  });
});
