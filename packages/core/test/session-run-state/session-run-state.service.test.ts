/**
 * SessionRunStateService 单元/集成测试。
 *
 * 覆盖：UPSERT 原子覆盖、按 status 扫描、settled 行字段语义、
 * 删会话/删项目后 run_state 行级联清理（含子会话与多会话项目）。
 *
 * schema 升级慢路径测试见 test/bootstrap/session-run-state-schema.test.ts。
 *
 * @module test/session-run-state/session-run-state.service.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionRunStateService } from "../../src/service/session-run-state/create-session-run-state-service.js";
import type { SessionRunState } from "../../src/domain/session-run-state/model/session-run-state.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 构造一行 run_state（部分字段可覆盖）。 */
function makeRow(
  sessionId: string,
  projectId: string,
  overrides: Partial<SessionRunState> = {}
): SessionRunState {
  return {
    sessionId,
    projectId,
    runId: `run-${sessionId}`,
    status: "starting",
    startedAtMs: 1000,
    textChars: 0,
    thinkingChars: 0,
    partialText: null,
    partialThinking: null,
    pendingChildrenJson: null,
    updatedAtMs: 1000,
    ...overrides,
  };
}

describe("SessionRunStateService", () => {
  it("UPSERT 原子覆盖：同 sessionId 二次写全列覆盖", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const sid = `upsert-${testIsolationSuffix()}`;
    const pid = `proj-${testIsolationSuffix()}`;

    await svc.upsert(
      makeRow(sid, pid, {
        status: "starting",
        runId: "run-old",
        textChars: 1,
        partialText: "旧 partial",
        pendingChildrenJson: '["child-1"]',
      })
    );
    await svc.upsert(
      makeRow(sid, pid, {
        status: "running",
        runId: "run-new",
        startedAtMs: 2000,
        textChars: 42,
        thinkingChars: 7,
        partialText: "新 partial",
        partialThinking: "新 thinking",
        pendingChildrenJson: "[]",
        updatedAtMs: 2500,
      })
    );

    const row = await svc.get(sid);
    assert.notEqual(row, null);
    assert.equal(row!.runId, "run-new");
    assert.equal(row!.status, "running");
    assert.equal(row!.startedAtMs, 2000);
    assert.equal(row!.textChars, 42);
    assert.equal(row!.thinkingChars, 7);
    assert.equal(row!.partialText, "新 partial");
    assert.equal(row!.partialThinking, "新 thinking");
    assert.equal(row!.pendingChildrenJson, "[]");
    assert.equal(row!.updatedAtMs, 2500);
  });

  it("按 status 扫描：starting/running 一批、settled 一批各自过滤正确", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const pid = `proj-${testIsolationSuffix()}`;
    const sStarting = `scan-starting-${testIsolationSuffix()}`;
    const sRunning = `scan-running-${testIsolationSuffix()}`;
    const sSettled = `scan-settled-${testIsolationSuffix()}`;

    await svc.upsert(makeRow(sStarting, pid, { status: "starting" }));
    await svc.upsert(makeRow(sRunning, pid, { status: "running" }));
    await svc.upsert(makeRow(sSettled, pid, { status: "settled" }));

    const active = await svc.listByStatuses(["starting", "running"]);
    const activeIds = active.map((row) => row.sessionId);
    assert.ok(activeIds.includes(sStarting));
    assert.ok(activeIds.includes(sRunning));
    assert.ok(!activeIds.includes(sSettled));

    const settled = await svc.listByStatuses(["settled"]);
    const settledIds = settled.map((row) => row.sessionId);
    assert.deepEqual(
      settledIds.filter((id) => id.startsWith("scan-")),
      [sSettled]
    );
    for (const row of settled) {
      assert.equal(row.status, "settled");
    }

    // 空状态列表直接返回空数组，不发 SQL。
    assert.deepEqual(await svc.listByStatuses([]), []);
  });

  it("settled 行字段语义：settle 后 partial 清空、metrics 保留", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const sid = `settle-${testIsolationSuffix()}`;
    const pid = `proj-${testIsolationSuffix()}`;

    // 先写 running 行（partial/pending 均有值）。
    await svc.upsert(
      makeRow(sid, pid, {
        status: "running",
        runId: "run-final",
        startedAtMs: 3000,
        textChars: 10,
        thinkingChars: 2,
        partialText: "在途 partial",
        partialThinking: "在途 thinking",
        pendingChildrenJson: '["child-a","child-b"]',
        updatedAtMs: 3500,
      })
    );

    // 收尾：写 settled 行（partial 清空、metrics 冻结为最终值）。
    await svc.settle({
      sessionId: sid,
      projectId: pid,
      runId: "run-final",
      startedAtMs: 3000,
      textChars: 100,
      thinkingChars: 25,
      updatedAtMs: 4000,
    });

    const row = await svc.get(sid);
    assert.notEqual(row, null);
    assert.equal(row!.status, "settled");
    assert.equal(row!.partialText, null);
    assert.equal(row!.partialThinking, null);
    assert.equal(row!.pendingChildrenJson, null);
    assert.equal(row!.textChars, 100);
    assert.equal(row!.thinkingChars, 25);
    assert.equal(row!.runId, "run-final");
    assert.equal(row!.startedAtMs, 3000);
    assert.equal(row!.updatedAtMs, 4000);

    // settled 行应出现在 settled 批次、不出现在 active 批次。
    const activeIds = (await svc.listByStatuses(["starting", "running"])).map(
      (r) => r.sessionId
    );
    assert.ok(!activeIds.includes(sid));
    const settledIds = (await svc.listByStatuses(["settled"])).map(
      (r) => r.sessionId
    );
    assert.ok(settledIds.includes(sid));
  });

  it("删行与按 session 删除：deleteBySession 生效且幂等", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const sid = `del-${testIsolationSuffix()}`;
    const pid = `proj-${testIsolationSuffix()}`;
    await svc.upsert(makeRow(sid, pid));
    assert.equal(await svc.deleteBySession(sid), true);
    assert.equal(await svc.get(sid), null);
    assert.equal(await svc.deleteBySession(sid), false);
  });

  it("会话删除级联：含子会话的 run_state 行一并清理", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id);
    const child = await ctx.sessions.createSubSession(parent.id, project.id);

    await svc.upsert(makeRow(parent.id, project.id, { status: "running" }));
    await svc.upsert(
      makeRow(child.id, project.id, { status: "settled", textChars: 9 })
    );

    await ctx.sessions.delete(parent.id);

    assert.equal(await svc.get(parent.id), null);
    assert.equal(await svc.get(child.id), null);
  });

  it("项目删除级联：多会话项目的 run_state 行全清", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSessionRunStateService(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const s1 = await ctx.sessions.create(project.id);
    const s2 = await ctx.sessions.create(project.id);
    const sub = await ctx.sessions.createSubSession(s1.id, project.id);

    await svc.upsert(makeRow(s1.id, project.id, { status: "running" }));
    await svc.upsert(makeRow(s2.id, project.id, { status: "starting" }));
    await svc.upsert(makeRow(sub.id, project.id, { status: "settled" }));

    await ctx.projects.delete(project.id);

    assert.equal(await svc.get(s1.id), null);
    assert.equal(await svc.get(s2.id), null);
    assert.equal(await svc.get(sub.id), null);
  });
});
