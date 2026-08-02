import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteSessionRepository } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("SqliteSessionRepository agent_config_json（v2，T-S2）", () => {
  it("set 写入后 get 读回一致；列不进 ChatSession 主模型", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "agent-config-rw");

    // create 后由 service 写入非空配置
    const initial = await repo.getSessionAgentConfig(session.id);
    assert.notEqual(initial, null);

    // 用仓储直接覆盖
    const json = JSON.stringify({ agentId: "agent-x" });
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
      JSON.stringify({ agentId: "a2" }),
      futureTs,
    );

    const after = await repo.findById(session.id);
    assert.ok(after);
    assert.equal(after!.updatedAtMs, futureTs);
  });

  it("set 传 null 清空列（仓储层仍允许 null，由 service/migration 保证不写 null）", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteSessionRepository(ctx.conn);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "agent-config-clear");

    // 仓储契约保持：null 仍可写入（供未来其它路径使用）
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
