import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("SqliteSessionRepository agent_config_json（T-S2）", () => {
  it("set 写入后 get 读回一致；列不进 ChatSession 主模型", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "agent-config-rw");

    // 默认 NULL
    assert.equal(await repo.getSessionAgentConfig(session.id), null);

    const json = JSON.stringify({ mode: "bind", agentId: "agent-x" });
    const now = Date.now();
    assert.equal(await repo.setSessionAgentConfig(session.id, json, now), true);

    assert.equal(await repo.getSessionAgentConfig(session.id), json);

    // 侧信道列不进 ChatSession 主模型
    const main = await repo.findById(session.id);
    assert.ok(main);
    assert.equal(
      (main as unknown as Record<string, unknown>).agentConfigJson,
      undefined,
    );
    assert.equal(
      (main as unknown as Record<string, unknown>).agent_config_json,
      undefined,
    );
  });

  it("NULL 读回为 null", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "agent-config-null");

    assert.equal(await repo.getSessionAgentConfig(session.id), null);
  });

  it("set 更新 updated_at_ms", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "agent-config-ts");

    const before = await repo.findById(session.id);
    assert.ok(before);
    const futureTs = before!.updatedAtMs + 60_000;
    await repo.setSessionAgentConfig(
      session.id,
      JSON.stringify({ mode: "follow" }),
      futureTs,
    );

    const after = await repo.findById(session.id);
    assert.ok(after);
    assert.equal(after!.updatedAtMs, futureTs);
  });

  it("set 传 null 清空列（解绑回 follow）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "agent-config-clear");

    await repo.setSessionAgentConfig(
      session.id,
      JSON.stringify({ mode: "bind", agentId: "a" }),
      Date.now(),
    );
    assert.notEqual(await repo.getSessionAgentConfig(session.id), null);

    await repo.setSessionAgentConfig(session.id, null, Date.now());
    assert.equal(await repo.getSessionAgentConfig(session.id), null);
  });

  it("不存在的会话 get 返回 null，set 返回 false", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal(await repo.getSessionAgentConfig("nope-not-exist"), null);
    assert.equal(
      await repo.setSessionAgentConfig("nope-not-exist", null, Date.now()),
      false,
    );
  });
});
