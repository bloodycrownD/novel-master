import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";

import {
  AgentConfigError,
  agentDefinitionSchema,
  createAgentRegistryService,
} from "@novel-master/core/agent";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("AgentRegistryService.list 虚拟 seed（T-C2 / P1-5）", () => {
  it("空 DB 时 list 包含虚拟 general", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const defs = await registry.list();
    const general = defs.find((d) => d.name === "general");
    assert.ok(general, "list 必须包含虚拟 general");
    assert.ok(
      general!.description != null && general!.description.length > 0,
      "虚拟 general 应带有 description，供 task 工具展示",
    );
  });

  it("get(<不存在的 uuid>) 报 AGENT_NOT_FOUND（get 不合并虚拟）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    await assert.rejects(
      () => registry.get("non-existent-uuid-xxx"),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "AGENT_NOT_FOUND",
    );
  });

  it("delete('general') 走 DB 路径报 AGENT_NOT_FOUND（虚拟不可删）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    await assert.rejects(
      () => registry.delete("general"),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "AGENT_NOT_FOUND",
    );
  });

  it("export 排除虚拟（listAgentIds 不含 general）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const ids = await registry.listAgentIds();
    // general 是虚拟的，没有 id，所以 listAgentIds 不应包含。
    assert.ok(!ids.includes("general"));
  });

  it("upsert 同名 general 后 DB 优先（list 返回 DB 版本，不重复）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const dbGeneralId = `db-general-${testIsolationSuffix()}`;
    await registry.upsert(
      dbGeneralId,
      decode(
        {
          schemaVersion: 1,
          name: "general",
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    const defs = await registry.list();
    const generals = defs.filter((d) => d.name === "general");
    assert.equal(generals.length, 1, "list 不应返回重复 general");
  });

  it("list 同时返回 DB 已有 agent + 虚拟 general", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const writerId = `writer-${testIsolationSuffix()}`;
    await registry.upsert(
      writerId,
      decode(
        {
          schemaVersion: 1,
          name: `writer-${testIsolationSuffix()}`,
          prompts: { persist: {}, dynamic: {} },
        },
        agentDefinitionSchema,
      ),
    );
    const defs = await registry.list();
    assert.ok(defs.some((d) => d.name === "general"));
    assert.ok(defs.some((d) => d.name.startsWith("writer-")));
  });
});
