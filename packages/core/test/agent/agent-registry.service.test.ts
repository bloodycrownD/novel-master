import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";

import { AgentConfigError, createAgentRegistryService, agentDefinitionSchema } from "@novel-master/core/agent";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("AgentRegistryService", () => {
  it("upsert preserves display name separate from agentId", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const def = decode(
      {
        schemaVersion: 1,
        name: "写作助手",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    );
    await registry.upsert("writer", def);
    const loaded = await registry.get("writer");
    assert.equal(loaded.name, "写作助手");
  });

  it("AG4: delete removes existing agent", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    await registry.upsert(
      "summarizer",
      decode(
        {
          schemaVersion: 1,
          name: "summarizer",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await registry.delete("summarizer");
    await assert.rejects(
      () => registry.get("summarizer"),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "AGENT_NOT_FOUND",
    );
  });

  it("upsert 拒绝与其他 Agent 重名的显示名", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const displayName = `写作助手-${testIsolationSuffix()}`;
    const def = decode(
      {
        schemaVersion: 1,
        name: displayName,
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    );
    await registry.upsert("writer-a", def);
    await assert.rejects(
      () => registry.upsert("writer-b", def),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.code === "DUPLICATE_NAME" &&
        e.message === "Agent 名称已存在",
    );
  });

  it("upsert 允许同一 Agent 保存原显示名", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const def = decode(
      {
        schemaVersion: 1,
        name: "写作助手",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    );
    await registry.upsert("writer", def);
    await registry.upsert("writer", { ...def, runtime: { maxSteps: 10 } });
    const loaded = await registry.get("writer");
    assert.equal(loaded.name, "写作助手");
    assert.equal(loaded.runtime?.maxSteps, 10);
  });

  it("upsert 保存前 trim 显示名并参与重名校验", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const displayName = `写作助手-${testIsolationSuffix()}`;
    await registry.upsert(
      "writer-a",
      decode(
        {
          schemaVersion: 1,
          name: `  ${displayName}  `,
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await assert.rejects(
      () =>
        registry.upsert(
          "writer-b",
          decode(
            {
              schemaVersion: 1,
              name: displayName,
              prompts: { persist: {}, dynamic: {} },
            },
            agentDefinitionSchema,
          ),
        ),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "DUPLICATE_NAME",
    );
  });
});
