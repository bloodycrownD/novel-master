/**
 * T-R1（rollback-large-jank Step 2）：plan 拉取范围收窄（listBySessionFromSeq，
 * 下界 = 触发消息 seq 含）后回滚结果与全量口径等价；SQL 口径断言收窄生效。
 *
 * 等价性的操作性断言：
 * - 锚点解析（tool_result 前向配对）不受收窄影响——锚点之前的消息不拉取，
 *   但配对只向 seq 更大方向找，结果与全量拉取时一致；
 * - undo_send / rewind 的截断边界与既有语义一致；
 * - 计数快照改走 countBySession（COUNT(*) 单行）后 A-22 冲突检测仍生效
 *   （既有 rollback-optimistic-lock.test.ts 回归兜底，此处断言 SQL 口径）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createMessageRollbackService } from "../../src/service/message-checkpoint/create-message-checkpoint-services.js";
import { openSqlCountingNovelMasterTestConnection } from "../helpers/sql-counting-connection.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("rollback plan 拉取收窄（T-R1）", () => {
  it("T-R1a: rewind 锚点 tool_result 前向配对不受收窄影响——锚点前消息保留、配对消息同截", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tr1a-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    // 锚点之前的历史（不参与 plan，但必须原样保留）。
    const user0 = await ctx.messages.append(session.id, "user", textBlocks("旧对话"));
    const assistant0 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "旧回复" }],
    });

    // 触发消息：带 tool_use 的 assistant（锚点应前向配对到其后的 tool_result）。
    const assistant1 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "tool_use", id: "tu-1", name: "read", input: {} }],
    });
    const toolResults = await ctx.messages.append(session.id, "user", {
      blocks: [
        { type: "tool_result", toolUseId: "tu-1", content: "ok" },
      ],
    });
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "总结" }],
    });

    const rollback = createMessageRollbackService(ctx.conn);
    await rollback.rollbackToMessage(session.id, project.id, assistant1.id, {
      skipVfsReconcile: true,
    });

    // 锚点解析为 tool_result（seq > assistant.seq）→ rewind 模式截
    // seq > toolResult.seq → 仅「总结」被截，user0/assistant0/assistant1/
    // toolResult 四条保留。若收窄破坏了前向配对（tool_result 在 clicked
    // 之后、本应仍在拉取窗口内），锚点会退回 assistant1 自身 → 截掉
    // toolResult 与总结、只剩 3 条——长度断言即失败，以此证明配对不受
    // 收窄影响。
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 4);
    assert.equal(left[0]!.id, user0.id);
    assert.equal(left[1]!.id, assistant0.id);
    assert.equal(left[2]!.id, assistant1.id);
    assert.equal(left[3]!.id, toolResults.id);
  });

  it("T-R1b: undo_send 中段 user 锚点——锚点前保留、锚点起（含）截断", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tr1b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const user0 = await ctx.messages.append(session.id, "user", textBlocks("保留"));
    const assistant0 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "ok" }],
    });
    const user1 = await ctx.messages.append(session.id, "user", textBlocks("锚点"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "被截" }],
    });

    const rollback = createMessageRollbackService(ctx.conn);
    await rollback.rollbackToMessage(session.id, project.id, user1.id, {
      skipVfsReconcile: true,
    });

    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
    assert.equal(left[0]!.id, user0.id);
    assert.equal(left[1]!.id, assistant0.id);
  });

  it("T-R1c: SQL 口径——plan 阶段 seq >= 收窄拉取 + COUNT(*) 计数快照，无全量 listBySession", async () => {
    const ctx = await openSqlCountingNovelMasterTestConnection();
    const project = await ctx.projects.create(`P-tr1c-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const user0 = await ctx.messages.append(session.id, "user", textBlocks("a"));
    const assistant0 = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "b" }],
    });
    await ctx.messages.append(session.id, "user", textBlocks("c"));
    await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "d" }],
    });

    ctx.counter.clear();
    const rollback = createMessageRollbackService(ctx.conn);
    await rollback.rollbackToMessage(session.id, project.id, assistant0.id, {
      skipVfsReconcile: true,
    });

    const sqlTexts = ctx.counter.all().map((r) => r.sql);
    // plan 拉取：seq >= 收窄形态出现（模板 #{fromSeq} 渲染为 ?）。
    assert.ok(
      sqlTexts.some((sql) => sql.includes("AND seq >= ?")),
      `应出现 seq >= 收窄拉取，实际 SQL：${sqlTexts.join(" | ")}`,
    );
    // 计数快照：COUNT(*) 单行形态出现。
    assert.ok(
      sqlTexts.some((sql) => sql.includes("SELECT COUNT(*) AS n FROM chat_message")),
      "应出现 countBySession 计数快照",
    );
    // 全量 listBySession（无 seq 限定的 ORDER BY seq ASC 单表拉取）不得出现。
    assert.ok(
      !sqlTexts.some((sql) =>
        sql.includes("FROM chat_message WHERE session_id = ? ORDER BY seq ASC"),
      ),
      "plan 阶段不应再发出无 seq 限定的全量 listBySession",
    );
    // 回滚语义不受收窄影响：rewind 保留锚点，其后两条截断。
    const left = await ctx.messages.listBySession(session.id);
    assert.equal(left.length, 2);
    assert.equal(left[1]!.id, assistant0.id);
  });
});
