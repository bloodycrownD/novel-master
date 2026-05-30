import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentConfigError,
  compactionPolicySchema,
  createAgentRegistryService,
  createCompactionPolicyStore,
  decode,
  agentDefinitionSchema,
} from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("AgentRegistryService", () => {
  it("upsert and get normalizes name to agentId", async () => {
    const ctx = await openNovelMasterTestConnection();
    const registry = createAgentRegistryService(ctx.conn);
    const def = decode(
      {
        schemaVersion: 1,
        name: "ignored",
        prompts: { blocks: {} },
      },
      agentDefinitionSchema,
    );
    await registry.upsert("writer", def);
    const loaded = await registry.get("writer");
    assert.equal(loaded.name, "writer");
    await ctx.conn.close();
  });

  it("AG4: delete fails when compaction references agent", async () => {
    const ctx = await openNovelMasterTestConnection();
    const compaction = createCompactionPolicyStore(ctx.conn);
    const registry = createAgentRegistryService(ctx.conn, { compactionPolicy: compaction });
    await registry.upsert(
      "summarizer",
      decode(
        {
          schemaVersion: 1,
          name: "summarizer",
          prompts: { blocks: {} },
        },
        agentDefinitionSchema,
      ),
    );
    await compaction.setPolicy(
      decode(
        {
          schemaVersion: 1,
          enabled: true,
          trigger: { tokenThreshold: 10 },
          action: {
            keepLastN: 2,
            abstract: { type: "agent", agentId: "summarizer" },
          },
        },
        compactionPolicySchema,
      ),
    );
    await assert.rejects(
      () => registry.delete("summarizer"),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "AGENT_IN_USE",
    );
    await ctx.conn.close();
  });
});
