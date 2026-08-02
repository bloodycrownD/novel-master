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

const TEST_SAVED_MODEL_GLOBAL = "33333333-3333-4333-8333-333333333333";
const TEST_SAVED_MODEL_CUSTOM = "44444444-4444-4444-8444-444444444444";

function customDefinition(name: string): AgentDefinition {
  return {
    name,
    prompts: { persist: [], dynamic: [] },
    model: TEST_SAVED_MODEL_CUSTOM,
  };
}

describe("resolveAgentForProject", () => {
  it("follow 模式返回 global 含 agentId", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    const globalDef = decode(
      {
        schemaVersion: 1,
        name: "全局助手",
        prompts: { persist: {}, dynamic: {} },
        model: TEST_SAVED_MODEL_GLOBAL,
      },
      agentDefinitionSchema,
    );
    await registry.upsert("global-agent", globalDef);
    await ctx.state.setCurrentAgentId("global-agent");

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    const resolved = await resolveAgentForProject(runtime, project.id, session.id);
    assert.equal(resolved.source, "global");
    if (resolved.source === "global") {
      assert.equal(resolved.agentId, "global-agent");
      assert.equal(resolved.definition.name, "全局助手");
    }
  });

  it("custom 模式返回 project-custom 且无 agentId", async () => {
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
    const custom = customDefinition("项目专属助手");
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: custom,
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
      sessions: ctx.sessions,
    };

    const resolved = await resolveAgentForProject(runtime, project.id, session.id);
    assert.equal(resolved.source, "project-custom");
    if (resolved.source === "project-custom") {
      assert.equal(resolved.definition.name, "项目专属助手");
      assert.equal(
        (resolved as { agentId?: string }).agentId,
        undefined,
      );
    }
  });

  it("custom 缺 definition 抛 AgentRunResolveError", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: {
        getAgentConfig: async () => ({
          mode: "custom" as const,
          definition: undefined,
        }),
      },
      sessions: {
        getSessionAgentConfig: async () => ({ mode: "follow" }),
      },
    };

    await assert.rejects(
      () => resolveAgentForProject(runtime, project.id, "sess-unused"),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });

  it("T-R2：project custom 时忽略 session 绑定（截断）", async () => {
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
    const custom = customDefinition("项目专属助手");
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: custom,
    });
    const session = await ctx.sessions.create(project.id, "S1");
    // 会话绑定到另一个 agent——custom 截断下应被忽略
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "bind-agent",
      modelId: TEST_SAVED_MODEL_GLOBAL,
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
    assert.equal(resolved.source, "project-custom");
    if (resolved.source === "project-custom") {
      assert.equal(resolved.definition.name, "项目专属助手");
      assert.equal(
        (resolved as { agentId?: string }).agentId,
        undefined,
      );
    }
  });

  it("T-R2：project follow + session bind → source: session-bind + 正确 definition", async () => {
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

    const bindDef = decode(
      {
        schemaVersion: 1,
        name: "会话绑定助手",
        prompts: { persist: {}, dynamic: {} },
        model: TEST_SAVED_MODEL_GLOBAL,
      },
      agentDefinitionSchema,
    );
    await registry.upsert("bind-agent", bindDef);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "bind-agent",
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
    assert.equal(resolved.source, "session-bind");
    if (resolved.source === "session-bind") {
      assert.equal(resolved.agentId, "bind-agent");
      assert.equal(resolved.definition.name, "会话绑定助手");
    }
  });

  it("T-R2：project follow + session follow → 回退 workspace 全局", async () => {
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
    // 会话默认 follow（未绑定）

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
    assert.equal(resolved.source, "global");
    if (resolved.source === "global") {
      assert.equal(resolved.agentId, "global-agent");
      assert.equal(resolved.definition.name, "全局助手");
    }
  });

  it("T-R3：session bind 的 agentId 在 registry 改 definition 后，下次 resolve 拿到新 definition（引用语义）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "bind-agent",
      decode(
        {
          schemaVersion: 1,
          name: "v1",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S1");
    await ctx.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "bind-agent",
    });

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
    assert.equal(first.source, "session-bind");
    if (first.source !== "session-bind") return;
    assert.equal(first.definition.name, "v1");

    // 会话绑定指向的 agentId 不变，但在 registry 里改了 definition 内容。
    await registry.upsert(
      "bind-agent",
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
    assert.equal(second.source, "session-bind");
    if (second.source !== "session-bind") return;
    // 每次 resolve 都从 registry 现取，拿到的是最新 definition（引用语义）。
    assert.equal(second.definition.name, "v2-after-update");
    assert.equal(second.agentId, "bind-agent");
    // 之前那次拿到的 v1 引用不受影响（不是共享可变 slot）。
    assert.equal(first.definition.name, "v1");
  });
});
