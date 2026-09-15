/**
 * session_run_state 的 fork/copy/置位/压缩守护测试（T-U8）。
 *
 * run_state 行描述「该会话当前 run 的现场」，属于会话运行态而非会话
 * 内容：fork/copy 产出的新会话不得继承（无行）；置位
 * （setMessageFloorAtMessage）/压缩（truncateMessagesAfter）是消息面
 * 操作，不得动到既有 run_state 行（运行中的 run 不因消息整理而失忆）。
 *
 * @module test/session-run-state/session-run-state.fork-copy-guard.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { createSessionRunStateService } from "../../src/service/session-run-state/create-session-run-state-service.js";
import { createMessageTranscriptEffectsService } from "../../src/service/chat/create-message-transcript-effects.js";
import type { SessionRunState } from "../../src/domain/session-run-state/model/session-run-state.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 构造一行运行中的 run_state（部分字段可覆盖）。 */
function makeRunningRow(
  sessionId: string,
  projectId: string,
  overrides: Partial<SessionRunState> = {}
): SessionRunState {
  return {
    sessionId,
    projectId,
    runId: `run-${sessionId}`,
    status: "running",
    startedAtMs: 1000,
    textChars: 42,
    thinkingChars: 7,
    partialText: "在途 partial",
    partialThinking: "在途思考",
    pendingChildrenJson: '["child-1"]',
    updatedAtMs: 2000,
    ...overrides,
  };
}

describe("session_run_state fork/copy/置位/压缩守护（T-U8）", () => {
  it("fork：新会话无 run_state 行，源会话行原样保留", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    const m2 = await ctx.messages.append(
      session.id,
      "assistant",
      textBlocks("2")
    );

    const row = makeRunningRow(session.id, project.id);
    await svc.upsert(row);

    const forked = await ctx.messages.fork(session.id, m2.id);

    assert.equal(await svc.get(forked.id), null);
    assert.deepEqual(await svc.get(session.id), row);
    // 语义补充：m1 之后 fork 与全量 fork 一致——本守护只关心 run_state，
    // 不重复覆盖 fork 内容语义。
    assert.notEqual(forked.id, session.id);
    void m1;
  });

  it("copy：新会话无 run_state 行，源会话行原样保留", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", textBlocks("u"));

    const row = makeRunningRow(session.id, project.id);
    await svc.upsert(row);

    const copied = await ctx.sessions.copy(session.id);

    assert.equal(await svc.get(copied.id), null);
    assert.deepEqual(await svc.get(session.id), row);
  });

  it("置位（setMessageFloorAtMessage）后既有 run_state 行不变", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const effects = createMessageTranscriptEffectsService(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const anchor = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("锚点")
    );
    await ctx.messages.append(session.id, "assistant", textBlocks("a"));

    const row = makeRunningRow(session.id, project.id);
    await svc.upsert(row);

    await effects.setMessageFloorAtMessage(project.id, session.id, anchor.id);

    assert.deepEqual(await svc.get(session.id), row);
  });

  it("压缩（truncateMessagesAfter）后既有 run_state 行不变", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const effects = createMessageTranscriptEffectsService(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const m1 = await ctx.messages.append(session.id, "user", textBlocks("1"));
    await ctx.messages.append(session.id, "assistant", textBlocks("2"));
    await ctx.messages.append(session.id, "user", textBlocks("3"));

    const row = makeRunningRow(session.id, project.id);
    await svc.upsert(row);

    await effects.truncateMessagesAfter(project.id, session.id, m1.seq);

    // 消息 tail 已删，但 run 态不是消息面数据——行原样。
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(messages.length, 1);
    assert.deepEqual(await svc.get(session.id), row);
  });
});
