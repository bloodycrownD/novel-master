import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigDecodeError } from "@novel-master/core";
import { ChatError } from "@novel-master/core/chat";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("SessionService agent config（T-S3）", () => {
  it("列 NULL 时 getSessionAgentConfig 返回默认 follow", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "default-follow");

    const config = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(config, { mode: "follow" });
  });

  it("patch { mode: follow } 整体替换为 follow，列存 NULL", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "to-follow");

    // 先 bind
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "a1",
    });
    assert.equal(
      (await ctx.sessions.getSessionAgentConfig(session.id)).mode,
      "bind",
    );

    // 再解绑
    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "follow",
    });
    assert.deepEqual(after, { mode: "follow" });

    // 列存 NULL：直接读仓储原始值
    const { SqliteSessionRepository } = await import(
      "../../../src/domain/chat/repositories/impl/sqlite-session.repository.js"
    );
    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal(await repo.getSessionAgentConfig(session.id), null);
  });

  it("patch { mode: bind; agentId } 整体替换为 bind（不带 modelId）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "to-bind");

    const saved = await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "agent-x",
    });
    assert.deepEqual(saved, { mode: "bind", agentId: "agent-x" });

    const loaded = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(loaded, { mode: "bind", agentId: "agent-x" });
  });

  it("patch { mode: bind; agentId; modelId } 带 modelId", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "bind-model");

    const saved = await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "agent-x",
      modelId: "gpt-4",
    });
    assert.deepEqual(saved, {
      mode: "bind",
      agentId: "agent-x",
      modelId: "gpt-4",
    });
  });

  it("patch { modelId: string } 在 bind 上覆盖 model，保持 agentId", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "model-override");

    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "agent-y",
    });
    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      modelId: "claude",
    });
    assert.deepEqual(after, {
      mode: "bind",
      agentId: "agent-y",
      modelId: "claude",
    });
  });

  it("patch { modelId: null } 清掉 model 覆盖，保持 bind", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "model-clear");

    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "agent-y",
      modelId: "claude",
    });
    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      modelId: null,
    });
    assert.deepEqual(after, { mode: "bind", agentId: "agent-y" });
  });

  it("patch { modelId } 在 follow 上拒绝（无 agentId）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "model-on-follow");

    await assert.rejects(
      () =>
        ctx.sessions.updateSessionAgentConfig(session.id, {
          modelId: "gpt-4",
        }),
      (error: unknown) =>
        error instanceof ChatError && error.code === "INVALID_ARGUMENT",
    );
  });

  it("patch { mode: bind } 缺 agentId 被 schema 拒绝（ConfigDecodeError）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "bind-no-agent");

    // 直接构造非法 wire 绕过 TS 类型，验证 schema 拒绝
    await assert.rejects(
      () =>
        ctx.sessions.updateSessionAgentConfig(session.id, {
          mode: "bind",
          agentId: "",
        } as unknown as { mode: "bind"; agentId: string }),
      ConfigDecodeError,
    );
  });

  it("copy 后新会话为 follow，不继承绑定（与 composer_draft_json 一致）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const source = await ctx.sessions.create(project.id, "copy-source");

    await ctx.sessions.updateSessionAgentConfig(source.id, {
      mode: "bind",
      agentId: "agent-z",
      modelId: "m1",
    });

    const copy = await ctx.sessions.copy(source.id);
    const sourceConfig = await ctx.sessions.getSessionAgentConfig(source.id);
    const copyConfig = await ctx.sessions.getSessionAgentConfig(copy.id);

    // 源不变
    assert.equal(sourceConfig.mode, "bind");
    // 副本默认 follow
    assert.deepEqual(copyConfig, { mode: "follow" });

    // 列也确实为 NULL
    const { SqliteSessionRepository } = await import(
      "../../../src/domain/chat/repositories/impl/sqlite-session.repository.js"
    );
    const repo = new SqliteSessionRepository(ctx.conn);
    assert.equal(await repo.getSessionAgentConfig(copy.id), null);
  });

  it("updateSessionAgentConfig 更新 updated_at_ms", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "ts-bump");

    const before = await ctx.sessions.get(session.id);
    await new Promise((r) => setTimeout(r, 5));
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "a",
    });
    const after = await ctx.sessions.get(session.id);
    assert.ok(after.updatedAtMs > before.updatedAtMs);
  });

  it("不存在的会话 getSessionAgentConfig 抛 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    await assert.rejects(
      () => ctx.sessions.getSessionAgentConfig("nope-not-exist"),
      (error: unknown) =>
        error instanceof ChatError && error.code === "NOT_FOUND",
    );
  });
});
