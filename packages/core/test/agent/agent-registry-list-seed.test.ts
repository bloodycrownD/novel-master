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

  it("upsert 同名 general 被拒绝（Step 6 禁止内置名重名，抛 INVALID_SCHEMA）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const dbGeneralId = `db-general-${testIsolationSuffix()}`;
    await assert.rejects(
      registry.upsert(
        dbGeneralId,
        decode(
          {
            schemaVersion: 1,
            name: "general",
            prompts: { persist: {}, dynamic: {} },
          },
          agentDefinitionSchema,
        ),
      ),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_SCHEMA",
    );
  });

  it("T-G1: 空 DB 时 list 返回的虚拟 general 满足 mode === subagent（FR-5）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn);
    const defs = await registry.list();
    const general = defs.find((d) => d.name === "general");
    assert.ok(general, "list 必须包含虚拟 general");
    assert.equal(
      general!.mode,
      "subagent",
      "虚拟 general 应带 mode=subagent，供 task 工具按 mode 过滤",
    );
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
