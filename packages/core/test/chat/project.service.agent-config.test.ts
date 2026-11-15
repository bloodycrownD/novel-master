import assert from "node:assert/strict";
import { rejectsErr, unwrap } from "../helpers/result-unwrap.js";
import { isAppError } from "../../src/errors/app-error.js";
import { describe, it } from "node:test";
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
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));

    const config = unwrap(await ctx.projects.getAgentConfig(project.id));
    assert.deepEqual(config, { mode: "follow" });
  });

  it("custom 配置 round-trip", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const definition = customDefinition("专属助手");

    const saved = unwrap(await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition,
    }));
    assert.equal(saved.mode, "custom");
    assert.equal(saved.definition?.name, "专属助手");

    const loaded = unwrap(await ctx.projects.getAgentConfig(project.id));
    assert.equal(loaded.mode, "custom");
    assert.equal(loaded.definition?.name, "专属助手");
  });

  it("copy 深拷贝 agent_config_json 至新项目", async () => {
    const ctx = getNovelMasterTestContext();
    const source = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const definition = customDefinition("可复制助手");
    unwrap(await ctx.projects.updateAgentConfig(source.id, {
      mode: "custom",
      definition,
    }));

    const copy = unwrap(await ctx.projects.copy(source.id));
    const sourceConfig = unwrap(await ctx.projects.getAgentConfig(source.id));
    const copyConfig = unwrap(await ctx.projects.getAgentConfig(copy.id));

    assert.equal(copyConfig.mode, "custom");
    assert.equal(copyConfig.definition?.name, "可复制助手");
    assert.notEqual(copyConfig.definition, sourceConfig.definition);
    assert.deepEqual(copyConfig.definition, sourceConfig.definition);
    assert.notEqual(copy.id, source.id);
  });

  it("非法 patch 拒绝", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));

    await assert.rejects(
      () =>
        ctx.projects.updateAgentConfig(project.id, {
          mode: "custom",
        }),
      (error: unknown) => error instanceof Error && error.name === "CONFIG_DECODE_INVALID_SCHEMA",
    );

    await assert.rejects(
      () =>
        ctx.projects.updateAgentConfig(project.id, {
          mode: "custom",
          definition: customDefinition(""),
        }),
      (error: unknown) => error instanceof Error && error.name === "CONFIG_DECODE_INVALID_SCHEMA",
    );
  });

  it("delete 后 getAgentConfig 不可访问", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    unwrap(await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: customDefinition("待删"),
    }));

    unwrap(await ctx.projects.delete(project.id));

    // 错误通道迁移二期：getAgentConfig 改走 Result 通道（Err 透传项目不存在）。
    await rejectsErr(
      () => ctx.projects.getAgentConfig(project.id),
      (error: unknown) =>
        isAppError(error, "CHAT_NOT_FOUND"),
    );
  });
});
