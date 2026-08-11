import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import {
  AgentRunResolveError,
  agentDefinitionSchema,
  createAgentRegistryService,
  resolveAgentForProject,
} from "@novel-master/core/agent";
import type { AgentDefinition } from "@novel-master/core/agent";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_SESSION = "33333333-3333-4333-8333-333333333333";
const TEST_SAVED_MODEL_CUSTOM = "44444444-4444-4444-8444-444444444444";

function customDefinition(name: string): AgentDefinition {
  return {
    name,
    prompts: { persist: [], dynamic: [] },
    model: TEST_SAVED_MODEL_CUSTOM,
  };
}

describe("resolveAgentForProject（v2，无 workspace 回退）", () => {
  it("项目智能体已下线：即使 DB 存 custom 配置也忽略，走 session 分支", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    const globalDef = decode(
      {
        schemaVersion: 1,
        name: "全局助手",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    );
    await registry.upsert("global-agent", globalDef);
    await ctx.state.setCurrentAgentId("global-agent");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    // 旧库可能残留 custom 配置——resolve 应忽略，不再截断 session。
    const custom = customDefinition("项目专属助手");
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: custom,
    });
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "global-agent",
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    const resolved = await resolveAgentForProject(runtime, project.id, session.id);
    // 项目智能体下线后永远走 session 分支，返回 session 级 definition + agentId。
    assert.equal(resolved.source, "session");
    if (resolved.source === "session") {
      assert.equal(resolved.agentId, "global-agent");
      assert.equal(resolved.definition.name, "全局助手");
    }
  });

  it("custom 缺 definition：项目智能体已下线，resolve 不再读 custom 配置，走 session 分支", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "global-agent",
      decode(
        {
          schemaVersion: 1,
          name: "全局助手",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("global-agent");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "global-agent",
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: {
        getAgentConfig: async () => ({
          mode: "custom" as const,
          definition: undefined,
        }),
      },
      sessions: ctx.sessions,
    };

    // 项目智能体下线后，即便 projects.getAgentConfig 返回 custom 缺 definition，
    // resolve 也不再读取它——直接走 session.agentId，不抛错。
    const resolved = await resolveAgentForProject(runtime, project.id, session.id);
    assert.equal(resolved.source, "session");
    if (resolved.source === "session") {
      assert.equal(resolved.agentId, "global-agent");
    }
  });

  it("T-R2：项目智能体已下线，DB 残留 custom 配置被忽略，session.agentId 正常生效", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "global-agent",
      decode(
        {
          schemaVersion: 1,
          name: "全局助手",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("global-agent");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    // 旧库残留 custom 配置——项目智能体下线后应被忽略。
    const custom = customDefinition("项目专属助手");
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: custom,
    });
    await registry.upsert(
      "session-agent",
      decode(
        {
          schemaVersion: 1,
          name: "会话引用助手",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    const session = await ctx.sessions.create(project.id, "S1");
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "session-agent",
      modelId: TEST_SAVED_MODEL_SESSION,
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    const resolved = await resolveAgentForProject(
      runtime,
      project.id,
      session.id,
    );
    // 不再被 custom 截断，走 session 分支拿 session-agent。
    assert.equal(resolved.source, "session");
    if (resolved.source === "session") {
      assert.equal(resolved.agentId, "session-agent");
      assert.equal(resolved.definition.name, "会话引用助手");
    }
  });

  it("project follow → session.agentId 取 definition，source: session", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "global-agent",
      decode(
        {
          schemaVersion: 1,
          name: "全局助手",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("global-agent");

    const bindDef = decode(
      {
        schemaVersion: 1,
        name: "会话引用助手",
        prompts: { persist: {}, dynamic: {} },
        model: TEST_SAVED_MODEL_SESSION,
      },
      agentDefinitionSchema,
    );
    await registry.upsert("session-agent", bindDef);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "session-agent",
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    const resolved = await resolveAgentForProject(
      runtime,
      project.id,
      session.id,
    );
    assert.equal(resolved.source, "session");
    if (resolved.source === "session") {
      assert.equal(resolved.agentId, "session-agent");
      assert.equal(resolved.definition.name, "会话引用助手");
    }
  });

  it("session.agentId 在 registry 不存在时抛 AgentRunResolveError", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "global-agent",
      decode(
        {
          schemaVersion: 1,
          name: "全局助手",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("global-agent");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    // 强行把 session 引用指向一个不存在的 agent
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "ghost-agent",
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    await assert.rejects(
      () => resolveAgentForProject(runtime, project.id, session.id),
      (error: unknown) =>
        error instanceof AgentRunResolveError &&
        error.message.includes("ghost-agent"),
    );
  });

  it("T-R3：session.agentId 在 registry 改 definition 后，下次 resolve 拿到新 definition（引用语义）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "session-agent",
      decode(
        {
          schemaVersion: 1,
          name: "v1",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("session-agent");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    const first = await resolveAgentForProject(
      runtime,
      project.id,
      session.id,
    );
    assert.equal(first.source, "session");
    if (first.source !== "session") return;
    assert.equal(first.definition.name, "v1");

    // 会话引用的 agentId 不变，但在 registry 里改了 definition 内容。
    await registry.upsert(
      "session-agent",
      decode(
        {
          schemaVersion: 1,
          name: "v2-after-update",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );

    const second = await resolveAgentForProject(
      runtime,
      project.id,
      session.id,
    );
    assert.equal(second.source, "session");
    if (second.source !== "session") return;
    // 每次 resolve 都从 registry 现取，拿到的是最新 definition（引用语义）。
    assert.equal(second.definition.name, "v2-after-update");
    assert.equal(second.agentId, "session-agent");
    // 之前那次拿到的 v1 引用不受影响（不是共享可变 slot）。
    assert.equal(first.definition.name, "v1");
  });
});
