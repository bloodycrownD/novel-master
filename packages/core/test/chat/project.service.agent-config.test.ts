import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigDecodeError } from "@novel-master/core";
import { ChatError } from "@novel-master/core/chat";
import type { AgentDefinition } from "@novel-master/core/agent";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

function customDefinition(name: string): AgentDefinition {
  return {
    name,
    prompts: { persist: [], dynamic: [] },
  };
}

novelMasterTestFixture();

describe("ProjectService agent config", () => {
  it("列 NULL 时 getAgentConfig 返回 follow", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);

    const config = await ctx.projects.getAgentConfig(project.id);
    assert.deepEqual(config, { mode: "follow" });
  });

  it("custom 配置 round-trip", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const definition = customDefinition("专属助手");

    const saved = await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition,
    });
    assert.equal(saved.mode, "custom");
    assert.equal(saved.definition?.name, "专属助手");

    const loaded = await ctx.projects.getAgentConfig(project.id);
    assert.equal(loaded.mode, "custom");
    assert.equal(loaded.definition?.name, "专属助手");
  });

  it("copy 深拷贝 agent_config_json 至新项目", async () => {
    const ctx = getNovelMasterTestContext();
    const source = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const definition = customDefinition("可复制助手");
    await ctx.projects.updateAgentConfig(source.id, {
      mode: "custom",
      definition,
    });

    const copy = await ctx.projects.copy(source.id);
    const sourceConfig = await ctx.projects.getAgentConfig(source.id);
    const copyConfig = await ctx.projects.getAgentConfig(copy.id);

    assert.equal(copyConfig.mode, "custom");
    assert.equal(copyConfig.definition?.name, "可复制助手");
    assert.notEqual(copyConfig.definition, sourceConfig.definition);
    assert.deepEqual(copyConfig.definition, sourceConfig.definition);
    assert.notEqual(copy.id, source.id);
  });

  it("非法 patch 拒绝", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);

    await assert.rejects(
      () =>
        ctx.projects.updateAgentConfig(project.id, {
          mode: "custom",
        }),
      ConfigDecodeError,
    );

    await assert.rejects(
      () =>
        ctx.projects.updateAgentConfig(project.id, {
          mode: "custom",
          definition: customDefinition(""),
        }),
      ConfigDecodeError,
    );
  });

  it("delete 后 getAgentConfig 不可访问", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: customDefinition("待删"),
    });

    await ctx.projects.delete(project.id);

    await assert.rejects(
      () => ctx.projects.getAgentConfig(project.id),
      (error: unknown) =>
        error instanceof ChatError && error.code === "NOT_FOUND",
    );
  });
});
