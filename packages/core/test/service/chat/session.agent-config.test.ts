import assert from "node:assert/strict";

// PersistentState.setCurrentModelId 会校验 UUID，测试里统一用这个常量。
const TEST_SAVED_MODEL_A = "11111111-1111-4111-8111-111111111111";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import { ChatError } from "@novel-master/core/chat";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function def(name: string) {
  return decode(
    {
      schemaVersion: 1,
      name,
      prompts: { persist: {}, dynamic: {} },
    },
    agentDefinitionSchema,
  );
}

describe("SessionService agent config（v2，T-S3）", () => {
  it("create 复制 workspace 当前 agentId + modelId 到新会话", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("ws-agent", def("ws-agent"));
    await ctx.state.setCurrentAgentId("ws-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_A);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "copy-ws");

    const config = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(config, { agentId: "ws-agent", modelId: TEST_SAVED_MODEL_A });
  });

  it("create workspace 无 modelId 时只写 agentId", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("ws-agent-2", def("ws-agent-2"));
    await ctx.state.setCurrentAgentId("ws-agent-2");
    await ctx.state.resetCurrentModelId();

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "no-model");

    const config = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(config, { agentId: "ws-agent-2" });
  });

  it("create workspace agentId 缺失时回落 registry 首项", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("alpha", def("alpha"));
    await ctx.agentRegistry.upsert("beta", def("beta"));
    await ctx.state.resetCurrentAgentId();
    await ctx.state.resetCurrentModelId();

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "fallback-registry");

    const config = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.equal(config.agentId, "alpha");
    assert.equal(config.modelId, undefined);
  });

  it("create workspace 与 registry 均空时抛 INVALID_ARGUMENT", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.resetCurrentAgentId();
    // registry 在 shared DB 中可能已有别的 agent，但 workspace 指针清空后
    // 若 registry 列表为空才会抛。这里改用一个隔离检查：mock 一个空 registry。
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);

    // 直接验证空 registry + 空 state 的 service 行为：
    // 构造一个临时 session service 实例（用空 registry），看 create 是否抛。
    const { DefaultSessionService } = await import(
      "../../../src/service/chat/impl/session.service.js"
    );
    const { SqliteProjectRepository } = await import(
      "../../../src/domain/chat/repositories/impl/sqlite-project.repository.js"
    );
    const { SqliteSessionRepository } = await import(
      "../../../src/domain/chat/repositories/impl/sqlite-session.repository.js"
    );
    const { SqliteMessageRepository } = await import(
      "../../../src/domain/chat/repositories/impl/sqlite-message.repository.js"
    );
    const { SqliteVfsEntryRepository } = await import(
      "../../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js"
    );
    const emptyState = {
      getCurrentAgentId: async () => undefined as string | undefined,
      getCurrentModelId: async () => undefined as string | undefined,
    };
    const emptyRegistry = { listAgentIds: async () => [] as const };
    const svc = new DefaultSessionService({
      conn: ctx.conn,
      projects: new SqliteProjectRepository(ctx.conn),
      sessions: new SqliteSessionRepository(ctx.conn),
      messages: new SqliteMessageRepository(ctx.conn),
      vfs: new SqliteVfsEntryRepository(ctx.conn),
      state: emptyState,
      agentRegistry: emptyRegistry,
    });

    await assert.rejects(
      () => svc.create(project.id, "should-fail"),
      (error: unknown) =>
        error instanceof ChatError && error.code === "INVALID_ARGUMENT",
    );
  });

  it("update partial overlay：仅切 agent 保留当前 modelId", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_A);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "only-agent");

    // 初始从 workspace 复制了 modelId，切 agent 必须保留它
    const before = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.equal(before.modelId, TEST_SAVED_MODEL_A);

    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "switched-agent",
    });
    assert.deepEqual(after, {
      agentId: "switched-agent",
      modelId: TEST_SAVED_MODEL_A,
    });

    const loaded = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(loaded, {
      agentId: "switched-agent",
      modelId: TEST_SAVED_MODEL_A,
    });
  });

  it("update partial overlay：仅切 model 保留当前 agentId", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "only-model");

    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      modelId: TEST_SAVED_MODEL_A,
    });
    assert.deepEqual(after, {
      agentId: "seed",
      modelId: TEST_SAVED_MODEL_A,
    });

    const loaded = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(loaded, {
      agentId: "seed",
      modelId: TEST_SAVED_MODEL_A,
    });
  });

  it("update partial overlay：传 null 清除 modelId，agentId 保留", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_A);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "clear-model");

    const before = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.equal(before.modelId, TEST_SAVED_MODEL_A);

    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {
      modelId: null,
    });
    assert.deepEqual(after, { agentId: "seed" });

    const loaded = await ctx.sessions.getSessionAgentConfig(session.id);
    assert.deepEqual(loaded, { agentId: "seed" });
  });

  it("update partial overlay：不传 modelId 字段保持当前值", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_A);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "keep-model");

    // patch 里两个都不传（空 patch），modelId 必须原地不动
    const after = await ctx.sessions.updateSessionAgentConfig(session.id, {});
    assert.deepEqual(after, {
      agentId: "seed",
      modelId: TEST_SAVED_MODEL_A,
    });
  });

  it("update merge 后非法 modelId 被 schema 拒绝", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "reject-empty");

    // partial overlay 下 agentId 会从 baseline 继承，schema 主要兌锋点变成 modelId。
    // 空串 modelId 不满足 min(1)，会被 schema 拒绝。
    // 这里按 name 判定（避免 tsx 双实例下 instanceof ConfigDecodeError prototype 不匹配）。
    await assert.rejects(
      () =>
        ctx.sessions.updateSessionAgentConfig(session.id, {
          modelId: "",
        }),
      (error: unknown) =>
        error instanceof Error && error.name === "ConfigDecodeError",
    );
  });

  it("getSessionAgentConfig 列 NULL 视为异常抛错", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "null-column");

    // 直接把列改回 NULL 模拟未迁移的老数据
    const { SqliteSessionRepository } = await import(
      "../../../src/domain/chat/repositories/impl/sqlite-session.repository.js"
    );
    const repo = new SqliteSessionRepository(ctx.conn);
    await repo.setSessionAgentConfig(session.id, null, Date.now());

    await assert.rejects(
      () => ctx.sessions.getSessionAgentConfig(session.id),
      (error: unknown) =>
        error instanceof ChatError && error.code === "INVALID_ARGUMENT",
    );
  });

  it("copy 继承源 session 的 agent_config_json", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_A);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const source = await ctx.sessions.create(project.id, "copy-source");

    // 改一下源配置，区别于 workspace 初始值
    await ctx.sessions.updateSessionAgentConfig(source.id, {
      agentId: "copied-agent",
      modelId: "copied-model",
    });

    const copy = await ctx.sessions.copy(source.id);
    const sourceConfig = await ctx.sessions.getSessionAgentConfig(source.id);
    const copyConfig = await ctx.sessions.getSessionAgentConfig(copy.id);

    // 源不变
    assert.deepEqual(sourceConfig, {
      agentId: "copied-agent",
      modelId: "copied-model",
    });
    // 副本继承源
    assert.deepEqual(copyConfig, {
      agentId: "copied-agent",
      modelId: "copied-model",
    });
  });

  it("updateSessionAgentConfig 更新 updated_at_ms", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.agentRegistry.upsert("seed", def("seed"));
    await ctx.state.setCurrentAgentId("seed");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "ts-bump");

    const before = await ctx.sessions.get(session.id);
    await new Promise((r) => setTimeout(r, 5));
    await ctx.sessions.updateSessionAgentConfig(session.id, {
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
