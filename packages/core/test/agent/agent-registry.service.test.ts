import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentConfigError,
  createAgentRegistryService,
  decode,
  agentDefinitionSchema,
} from "@novel-master/core";
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
        prompts: { blocks: {} },
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
          prompts: { blocks: {} },
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
});
