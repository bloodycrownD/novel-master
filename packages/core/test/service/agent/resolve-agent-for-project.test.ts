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
    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
    };

    const resolved = await resolveAgentForProject(runtime, project.id);
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
    const custom = customDefinition("项目专属助手");
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: custom,
    });

    const runtime = {
      state: ctx.state,
      agentRegistry: registry,
      projects: ctx.projects,
    };

    const resolved = await resolveAgentForProject(runtime, project.id);
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
    };

    await assert.rejects(
      () => resolveAgentForProject(runtime, project.id),
      (error: unknown) => error instanceof AgentRunResolveError,
    );
  });
});
